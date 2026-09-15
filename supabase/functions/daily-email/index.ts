// @ts-nocheck — runs in Deno (Supabase Edge Functions), not Node; Deno globals are valid at runtime

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlantStatus {
  name: string;
  species: string;
  watering: string;
  wateringDue: boolean;
  fertilize: string;
  fertilizeDue: boolean;
  repot: string;
  repotDue: boolean;
}

function renderPlantCard(p: PlantStatus): string {
  const rows = [
    { icon: "💧", label: "მორწყვა", text: p.watering, due: p.wateringDue },
    { icon: "🌱", label: "სასუქი", text: p.fertilize, due: p.fertilizeDue },
    { icon: "🪴", label: "გადარგვა", text: p.repot, due: p.repotDue },
  ];

  return `
    <div style="background:#fff;border:1px solid #e0d4c0;border-radius:8px;padding:16px 18px;margin-bottom:12px;">
      <p style="font-size:15px;font-weight:700;color:#1c1814;margin:0 0 4px;">🌿 ${p.name}</p>
      <p style="font-size:12px;color:#7a6e58;margin:0 0 10px;">${p.species}</p>
      ${rows.map((r) => `
        <div style="display:flex;align-items:baseline;gap:8px;padding:4px 0;">
          <span style="font-size:13px;${r.due ? "color:#a01414;font-weight:700;" : "color:#1c1814;"}">${r.icon} ${r.label}:</span>
          <span style="font-size:13px;${r.due ? "color:#a01414;font-weight:700;" : "color:#5a4004;"}">${r.text}</span>
        </div>`).join("")}
    </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const email = body.email as string;
    const plants = (body.plants as PlantStatus[]) || [];

    if (!email) {
      return new Response(JSON.stringify({ error: "email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Intl.DateTimeFormat("ka-GE", {
      day: "numeric", month: "long", year: "numeric"
    }).format(new Date());

    const dueCount = plants.filter((p) => p.wateringDue || p.fertilizeDue || p.repotDue).length;
    const summaryText = plants.length === 0
      ? "ჯერ არცერთი მცენარე არ გაქვთ დამატებული."
      : dueCount > 0
      ? `დღეს ${dueCount} მცენარეს სჭირდება ყურადღება.`
      : "დღეს ყველა მცენარე მოვლილია — დამატებითი ქმედება საჭირო არ არის.";

    const html = `
<!DOCTYPE html>
<html lang="ka">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f4f0;font-family:'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">

    <div style="background:#1a3a0e;border-radius:12px 12px 0 0;padding:24px 28px;">
      <p style="color:rgba(255,255,255,.6);font-size:13px;margin:0 0 4px;">🌱 PlantCare</p>
      <h1 style="color:#eee8dc;font-size:22px;margin:0;">${today}</h1>
      <p style="color:rgba(238,232,220,.7);font-size:14px;margin:6px 0 0;">${summaryText}</p>
    </div>

    <div style="background:#fff;padding:20px 24px;border-left:1px solid #e0d4c0;border-right:1px solid #e0d4c0;border-bottom:1px solid #e0d4c0;border-radius:0 0 12px 12px;">
      ${plants.length ? plants.map(renderPlantCard).join("") : `<p style="font-size:14px;color:#7a6e58;margin:0;">დაამატეთ პირველი მცენარე PlantCare-ში, რომ მიიღოთ ყოველდღიური მოვლის შეხსენებები.</p>`}
    </div>

    <div style="text-align:center;padding:16px 0;">
      <p style="color:#7a6e58;font-size:12px;margin:0;">🌱 PlantCare — მცენარეების მოვლის ასისტენტი</p>
    </div>

  </div>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PlantCare <onboarding@resend.dev>",
        to: [email],
        subject: `🌱 PlantCare — ${today}${dueCount > 0 ? ` — ${dueCount} მცენარეს სჭირდება ყურადღება` : ""}`,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: JSON.stringify(data) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
