// @ts-nocheck — runs in Deno (Supabase Edge Functions), not Node; Deno globals are valid at runtime

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlantContext {
  name: string;
  species: string;
  latinName?: string;
  location?: string;
  windowDirection?: string;
  lastWatered?: string | null;
  lastFertilized?: string | null;
  lastRepotted?: string | null;
  commonProblems?: Array<{ symptom: string; cause: string; fix: string }>;
}

function formatPlantsSummary(plants: PlantContext[]): string {
  if (!plants?.length) return "მცენარეები ჯერ არ არის დამატებული.";
  return plants.map((p) => {
    const species = p.latinName ? `${p.species}, ${p.latinName}` : p.species;
    const problems = (p.commonProblems || [])
      .map((cp) => `${cp.symptom} → ${cp.cause} → ${cp.fix}`)
      .join("; ");
    return `• ${p.name} (${species}) — ოთახი: ${p.location || "უცნობი"}, ფანჯარა: ${p.windowDirection || "უცნობი"}. ` +
      `ბოლო მორწყვა: ${p.lastWatered || "არასდროს"}, ბოლო გამოკვება: ${p.lastFertilized || "არასდროს"}, ბოლო გადარგვა: ${p.lastRepotted || "არასდროს"}. ` +
      `ცნობილი პრობლემები: ${problems || "არ არის მითითებული"}`;
  }).join("\n");
}

// ── Summarize action ──────────────────────────────────────────────────────────
async function handleSummarize(body: Record<string, unknown>, groqKey: string): Promise<Response> {
  const messages = (body.messages as Array<{role: string; text: string}>) || [];
  const date = (body.date as string) || "";
  const conversation = messages
    .map((m) => `${m.role === "user" ? "მომხმარებელი" : "ასისტენტი"}: ${m.text}`)
    .join("\n");

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: "CRITICAL: Respond ONLY in Georgian language, never in English. შენ ხარ სახლის მცენარეების მოვლის ექსპერტი. შეაჯამე მოცემული საუბარი მხოლოდ ქართულად, მოკლედ — 2-3 სრული ქართული წინადადებით. ხაზი გაუსვი მნიშვნელოვან რჩევებს და დასკვნებს.",
        },
        {
          role: "user",
          content: `${date}-ის საუბარი:\n\n${conversation}`,
        },
      ],
      max_tokens: 300,
      temperature: 0.4,
    }),
  });

  const groqText = await groqRes.text();
  if (!groqRes.ok) {
    return new Response(JSON.stringify({ error: `Groq error ${groqRes.status}: ${groqText}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const groqData = JSON.parse(groqText);
  const summary = groqData.choices?.[0]?.message?.content || "";
  return new Response(JSON.stringify({ summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action || "chat";
    const message = (body.message as string) || "";
    const imageBase64 = (body.imageBase64 as string | null) || null;
    const context = (body.context as { plants?: PlantContext[]; activePlantName?: string | null }) || {};

    const groqKey = Deno.env.get("GROQ_API_KEY");
    if (!groqKey) {
      return new Response(JSON.stringify({ error: "GROQ_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "summarize") {
      return await handleSummarize(body as Record<string, unknown>, groqKey);
    }

    const plants = context.plants || [];
    const activePlant = plants.find((p) => p.name === context.activePlantName) || null;
    const plantsSummary = formatPlantsSummary(plants);

    const photoInstruction = imageBase64 && activePlant
      ? `\nᲤᲝᲢᲝᲡ ᲐᲜᲐᲚᲘᲖᲘᲡ ᲘᲜᲡᲢᲠᲣᲥᲪᲘᲐ: მომხმარებლის ამჟამად არჩეული მცენარეა "${activePlant.species}" (${activePlant.name}). გაანალიზე ფოტო ამ სახეობისთვის დამახასიათებელი დაავადებებისა და მავნებლების გათვალისწინებით. ნუ შესთავაზებ, რომ ეს სხვა სახეობის მცენარეა.\n\nINSTRUCTION FOR PHOTO ANALYSIS: The user's currently selected plant is definitively "${activePlant.species}". Analyze the photo only for diseases and pests known to affect this species.`
      : "";

    const system = `CRITICAL LANGUAGE RULE: You MUST respond ONLY in Georgian (ქართული ენა). Never write English words, sentences, or bullet points. If you are about to write an English word, translate it to Georgian instead.
შენ ხარ გამოცდილი სახლის მცენარეების მოვლისა და ბინაში მებაღეობის ექსპერტი (houseplant & indoor gardening specialist) და დამხმარე ასისტენტი მცენარეების მოყვარულთათვის.

შენი კომპეტენციის სფერო ფართოა — მიესალმე და უპასუხე ნებისმიერ კითხვას, რომელიც დაკავშირებულია: მცენარეების მორწყვასთან, განათებასთან, სასუქთან, გადარგვასთან, ნიადაგთან და ქოთნებთან, ტენიანობასთან, დაავადებებთან და მავნებლებთან, მცენარის შერჩევასთან (რომელი მცენარე მოერგება რომელ ოთახს/პირობებს), ტოქსიკურობასთან შინაური ცხოველებისთვის, გამრავლებასთან (ჩითილი, ნაწლავი) და საერთოდ ბინაში/აივანზე მებაღეობასთან. ეჭვის შემთხვევაში, ივარაუდე რომ კითხვა დაკავშირებულია — არ იყო ზედმეტად შემზღუდველი.

წესები:
- წერე მხოლოდ და მხოლოდ ქართულად — არცერთი ინგლისური სიტყვა ან წინადადება! სალიტერატურო, მარტივად გასაგები ენით
- პასუხი იყოს მოკლე და კონკრეტული — არ დაწეროთ ზედმეტი
- გამოიყენე bullet points (•) — თითოეული პუნქტი 1 კონკრეტული რჩევა
- მაქსიმუმ 4-5 bullet point, თითოეული მაქსიმუმ 1 წინადადება
- ბოლოს 1 მოკლე დასკვნითი წინადადება (სურვილისამებრ)
- პასუხი სრულად დასრულდეს — არასოდეს გაწყდეს შუაში
- თუ მომხმარებელი კონკრეტულ მცენარეს არ ასახელებს, იგულისხმე რომ საუბარია მის ამჟამად არჩეულ მცენარეზე
- ტოქსიკურობის შესახებ კითხვისას (შინაური ცხოველები, ბავშვები) — გაფრთხილება მკაფიოდ მიეცი
- უარი თქვი მოკლედ მხოლოდ იმ შემთხვევაში, თუ კითხვას მცენარეებთან, ბაღთან ან მებაღეობასთან საერთოდ არაფერი აქვს საერთო (მაგ.: სპორტი, პოლიტიკა, კულინარია, ტექნიკა) — ასეთ შემთხვევაში აუხსენი, რომ ეს შენს კომპეტენციაში არ შედის
${photoInstruction}

--- ზოგადი მოვლის რესურსები ---
სასუქი: თხევადი, დაბალანსებული (NPK) სასუქი მცენარეების უმეტესობისთვის ზრდის სეზონზე (მარტი-ოქტომბერი).
დრენაჟი: პერლიტი ან წვრილი ხრეში წყლის სტაგნაციის თავიდან ასაცილებლად.
მავნებლების საწინააღმდეგო: ნიმის ზეთი ან საპნის ხსნარი ბუგრების, ტკიპების და ფარიანების წინააღმდეგ.
ნიადაგი: უნივერსალური ჰორტიკულტურული ნიადაგი, სუკულენტებისთვის/კაქტუსებისთვის — სპეციალური კარგად დრენირებადი ნარევი.

--- მომხმარებლის მცენარეები ---
${plantsSummary}

ამჟამად არჩეული მცენარე: ${context.activePlantName || "არცერთი"}`;

    const userContent = imageBase64
      ? [
          { type: "text", text: message || "გაანალიზე ეს ფოტო და მომახსენე რა დაავადება ან პრობლემა ჩანს." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ]
      : message;

    const model = imageBase64
      ? "qwen/qwen3.6-27b"
      : "openai/gpt-oss-120b";

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        max_tokens: 1200,
        temperature: 0.5,
      }),
    });

    const groqText = await groqRes.text();
    if (!groqRes.ok) {
      return new Response(JSON.stringify({ error: `Groq error ${groqRes.status}: ${groqText}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqData = JSON.parse(groqText);
    const answer = groqData.choices?.[0]?.message?.content || "პასუხი ვერ მოიძებნა.";

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
