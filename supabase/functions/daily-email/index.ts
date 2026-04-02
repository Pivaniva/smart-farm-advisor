// @ts-nocheck — runs in Deno (Supabase Edge Functions), not Node; Deno globals are valid at runtime

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { email, crop, location, stage, weather, watering, risk, spraying, fertilizer, alert, harvest } = body;

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

    const riskColor = risk === "მაღალი" ? "#dc2626" : risk === "საშუალო" ? "#d97706" : "#16a34a";
    const riskBg   = risk === "მაღალი" ? "#fef2f2" : risk === "საშუალო" ? "#fffbeb" : "#f0fdf4";

    const html = `
<!DOCTYPE html>
<html lang="ka">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f4f0;font-family:'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">

    <div style="background:#1a3a0e;border-radius:12px 12px 0 0;padding:24px 28px;">
      <p style="color:rgba(255,255,255,.6);font-size:13px;margin:0 0 4px;">🌱 SmartFarm</p>
      <h1 style="color:#eee8dc;font-size:22px;margin:0;">${today}</h1>
      <p style="color:rgba(238,232,220,.7);font-size:14px;margin:6px 0 0;">${crop} — ${location}</p>
    </div>

    <div style="background:#fff;padding:24px 28px;border-left:1px solid #e0d4c0;border-right:1px solid #e0d4c0;">

      <div style="background:#fdf8e4;border:1.5px solid #e8d070;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="color:#5a4004;font-size:14px;margin:0;font-weight:500;">⚠ ${alert}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;width:36%">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;letter-spacing:.06em;">ზრდის ფაზა</span><br/>
            <span style="font-size:14px;color:#1c1814;">🌿 ${stage}</span>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #f0e8d8;">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;letter-spacing:.06em;">ამინდი</span><br/>
            <span style="font-size:14px;color:#1c1814;">${weather}</span>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding:10px 14px;border-bottom:1px solid #f0e8d8;">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;letter-spacing:.06em;">სავარაუდო მოსავალი</span><br/>
            <span style="font-size:14px;color:#1c1814;">🌾 ${harvest}</span>
          </td>
        </tr>
      </table>

      <h3 style="font-size:13px;font-weight:700;text-transform:uppercase;color:#7a6e58;letter-spacing:.06em;margin:0 0 12px;">დღევანდელი რეკომენდაციები</h3>

      <div style="background:#f2f7ec;border:1px solid #c8d8a8;border-left:4px solid #3d7224;border-radius:8px;padding:14px 16px;margin-bottom:10px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;margin:0 0 6px;letter-spacing:.06em;">💧 მორწყვა</p>
        <p style="font-size:14px;color:#1c1814;margin:0;">${watering}</p>
      </div>

      <div style="background:${riskBg};border:1px solid #e0d4c0;border-left:4px solid ${riskColor};border-radius:8px;padding:14px 16px;margin-bottom:10px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;margin:0 0 6px;letter-spacing:.06em;">🦠 დაავადების რისკი</p>
        <p style="font-size:14px;font-weight:700;color:${riskColor};margin:0;">${risk}</p>
      </div>

      <div style="background:#fff8f2;border:1px solid #e0d4c0;border-left:4px solid #c4621a;border-radius:8px;padding:14px 16px;margin-bottom:10px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;margin:0 0 6px;letter-spacing:.06em;">🌿 შეწამვლა</p>
        <p style="font-size:14px;color:#1c1814;margin:0;">${spraying}</p>
      </div>

      <div style="background:#f2f7ec;border:1px solid #c8d8a8;border-left:4px solid #3d7224;border-radius:8px;padding:14px 16px;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#7a6e58;margin:0 0 6px;letter-spacing:.06em;">🌱 სასუქი</p>
        <p style="font-size:14px;color:#1c1814;margin:0;">${fertilizer}</p>
      </div>

    </div>

    <div style="background:#1a3a0e;border-radius:0 0 12px 12px;padding:16px 28px;text-align:center;">
      <p style="color:rgba(238,232,220,.45);font-size:12px;margin:0;">🌱 SmartFarm — ჭკვიანი სოფლის მეურნეობა</p>
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
        from: "SmartFarm <onboarding@resend.dev>",
        to: [email],
        subject: `🌱 SmartFarm — ${today} — ${crop}`,
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
