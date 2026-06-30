// Vercel Cron Job — /api/telegram-alert.js
// Runs every 2 hours (via cron-job.org), sends Telegram alerts for:
// 1. PDUFA calendar countdown (30/7/1/0 days) — auto-skips dates already resolved by FDA filing check
// 2. New FDA approvals (Priority/Breakthrough/Orphan) in last 48h
// 3. NEW: FDA applications newly RECEIVED (early pipeline signal — 10-12mo runway)
// 4. NEW: EMA CHMP Positive Opinions (67 days before EC decision — pre-approval alpha)
// 5. Daily morning briefing at 9 AM Athens

export const config = {
  runtime: 'edge',
};

const PDUFA_CALENDAR = [
  { date:"2026-06-30", ticker:"IONS",  drug:"Olezarsen (TRYNGOLZA)", indication:"Severe hypertriglyceridemia", type:"NDA" },
  { date:"2026-07-29", ticker:"AMGN",  drug:"Tavneos", indication:"ANCA vasculitis — EMA hearing", type:"EMA" },
  { date:"2026-08-12", ticker:"RVMD",  drug:"Daraxonrasib", indication:"Metastatic PDAC (2L)", type:"NDA rolling" },
  { date:"2026-09-15", ticker:"AAPG",  drug:"Lisaftoclax", indication:"Higher-risk MDS", type:"NDA" },
  { date:"2026-10-15", ticker:"SRPT",  drug:"Elevidys", indication:"Duchenne MD (ages 4-7)", type:"BLA" },
  { date:"2027-01-15", ticker:"RVMD",  drug:"Daraxonrasib", indication:"PDAC — full FDA approval", type:"NDA" },
  { date:"2027-02-20", ticker:"IONS",  drug:"Tominersen", indication:"Huntington's disease", type:"NDA" },
];

async function sendTelegram(token, chatId, message) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true, // FIX: avoid broken link previews
    }),
  });
  return r.ok;
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr);
  return Math.round((d - today) / 86400000);
}

// FIX P_FIX2: check if FDA already acted on this drug BEFORE the PDUFA date
// (common — FDA often approves/rejects ahead of deadline)
async function checkIfAlreadyResolved(ticker, drugKeyword) {
  try {
    const today = new Date();
    const ninetyDaysAgo = new Date(today); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;

    const url = `https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:"${encodeURIComponent(ticker)}"+AND+submissions.submission_status_date:[${fmt(ninetyDaysAgo)}+TO+${fmt(today)}]&limit=20`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const results = data?.results || [];

    for (const app of results) {
      const subs = app.submissions || [];
      const approved = subs.find(s => s.submission_status === "AP" || s.submission_status === "TA");
      if (approved) {
        return { resolved: true, date: approved.submission_status_date, status: "APPROVED" };
      }
    }
  } catch(e) { /* silent */ }
  return null;
}

export default async function handler(req) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return new Response('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars', { status: 500 });
  }

  const alerts = [];

  // ── 1. PDUFA CALENDAR — with resolved-check ──
  for (const p of PDUFA_CALENDAR) {
    const days = daysUntil(p.date);
    if (days < -3 || days > 35) continue; // skip far future/past — keep alerts relevant

    const dateStr = new Date(p.date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});

    // FIX P_FIX2: if PDUFA is within 7 days, check whether FDA already resolved it
    if (days <= 7 && days >= -3) {
      const resolved = await checkIfAlreadyResolved(p.ticker, p.drug);
      if (resolved?.resolved) {
        // Only alert once about resolution, not repeat "PDUFA TODAY" spam
        const resDate = new Date(resolved.date.replace(/(\d{4})(\d{2})(\d{2})/,"$1-$2-$3"));
        const daysAgoResolved = Math.round((new Date() - resDate) / 86400000);
        if (daysAgoResolved <= 2) { // only alert if resolved in last 2 days
          alerts.push(
            `✅ <b>FDA DECISION CONFIRMED</b>\n` +
            `💊 <b>${p.drug}</b> (${p.ticker})\n` +
            `📋 ${p.indication}\n` +
            `🟢 Status: <b>APPROVED</b> (resolved ${daysAgoResolved===0?"today":daysAgoResolved+"d ago"}, ahead of PDUFA ${dateStr})\n` +
            `⚡ <b>ACTION: Review price action — approval likely already priced in. Check for pullback entry.</b>\n` +
            `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
          );
        }
        continue; // skip the normal countdown alerts for this one — already resolved
      }
    }

    if (days === 30) {
      alerts.push(
        `🟡 <b>PDUFA IN 30 DAYS</b>\n💊 <b>${p.drug}</b> (${p.ticker})\n📋 ${p.indication}\n📅 Decision: ${dateStr}\n` +
        `⚡ <b>ACTION: Build position now. Pre-PDUFA run-up typically starts here.</b>\n` +
        `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
      );
    } else if (days === 7) {
      alerts.push(
        `🔴 <b>PDUFA THIS WEEK — ${days} DAYS</b>\n💊 <b>${p.drug}</b> (${p.ticker})\n📋 ${p.indication}\n📅 Decision: ${dateStr}\n` +
        `⚡ <b>ACTION: Final position sizing. Set stop-loss. FDA can act EARLY — watch daily.</b>\n` +
        `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
      );
    } else if (days === 1) {
      alerts.push(
        `🚨 <b>PDUFA TOMORROW!</b>\n💊 <b>${p.drug}</b> (${p.ticker})\n📋 ${p.indication}\n📅 Decision: ${dateStr}\n` +
        `⚡ <b>CRITICAL: Position must be set NOW. FDA decision expected within 24h.</b>\n` +
        `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
      );
    } else if (days === 0) {
      // FIX P_FIX: removed dead FDA.gov link, replaced with working press announcements page
      alerts.push(
        `🚨🚨 <b>PDUFA TODAY — WATCH FOR NEWS</b>\n💊 <b>${p.drug}</b> (${p.ticker})\n📋 ${p.indication}\n` +
        `⚡ Decision expected today or may already be resolved — check news.\n` +
        `🌐 <a href="https://www.google.com/search?q=${encodeURIComponent(p.drug+" FDA decision "+p.ticker)}">Search Latest News</a>\n` +
        `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
      );
    }
  }

  // ── 2. NEW FDA APPROVALS (last 48h) ──
  try {
    const today = new Date();
    const twoDaysAgo = new Date(today); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;

    const fdaURL = `https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_status_date:[${fmt(twoDaysAgo)}+TO+${fmt(today)}]+AND+submissions.submission_status:AP&limit=20`;
    const r = await fetch(fdaURL);
    if (r.ok) {
      const data = await r.json();
      const results = data?.results || [];
      for (const app of results) {
        const appNum = app.application_number || "";
        const appType = appNum.slice(0,3);
        if (appType === "AND") continue;

        const subs = app.submissions || [];
        const allSubText = subs.map(s => (s.submission_type||"")+" "+(s.application_docs||[]).map(d=>d.type||"").join(" ")).join(" ").toUpperCase();
        const isPriority    = allSubText.includes("PRIORITY") || (subs[0]?.review_priority||"").toUpperCase()==="PRIORITY";
        const isBreakthrough= allSubText.includes("BREAKTHROUGH");
        const isOrphan      = allSubText.includes("ORPHAN");

        if (isPriority || isBreakthrough || isOrphan) {
          const product = (app.products||[])[0]||{};
          const name = product.brand_name || product.generic_name || app.sponsor_name || "Unknown";
          const openFDA = app.openfda || {};
          const substance = (openFDA.substance_name||[]).join(", ") || product.generic_name || "";

          const flags = [
            isPriority    ? "⭐ Priority Review" : "",
            isBreakthrough? "🔬 Breakthrough Therapy" : "",
            isOrphan      ? "🏥 Orphan Drug" : "",
          ].filter(Boolean).join(" · ");

          alerts.push(
            `🔴 <b>NEW FDA APPROVAL — ${appType}</b>\n💊 <b>${name}</b>\n🏢 ${app.sponsor_name || ""}\n` +
            `🧪 ${substance.slice(0,80)}\n${flags}\n` +
            `⚡ <b>ACTION: Analyse within 24h. Check pharma-signal-monitor.vercel.app</b>`
          );
        }
      }
    }
  } catch(e) { /* silent */ }

  // ── 3. NEW: FDA APPLICATIONS NEWLY RECEIVED (early pipeline signal) ──
  // Catches NDA/BLA filings at submission stage — 10-12 months runway before decision
  try {
    const today = new Date();
    const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;

    // submission_status "AP","TA" = approved; we want submission_type that signals new filing
    const fdaURL = `https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_status_date:[${fmt(sevenDaysAgo)}+TO+${fmt(today)}]+AND+submissions.submission_type:"ORIG"&limit=20`;
    const r = await fetch(fdaURL);
    if (r.ok) {
      const data = await r.json();
      const results = data?.results || [];
      for (const app of results) {
        const appNum = app.application_number || "";
        const appType = appNum.slice(0,3);
        if (appType === "AND") continue;

        const subs = app.submissions || [];
        const latest = subs.find(s => s.submission_type === "ORIG");
        if (!latest) continue;
        // Only flag if review_priority is Priority (most investable)
        if ((latest.review_priority||"").toUpperCase() !== "PRIORITY") continue;

        const product = (app.products||[])[0]||{};
        const name = product.brand_name || product.generic_name || app.sponsor_name || "Unknown";

        alerts.push(
          `🆕 <b>NEW FDA FILING RECEIVED — ${appType}</b>\n💊 <b>${name}</b>\n🏢 ${app.sponsor_name || ""}\n` +
          `⭐ Priority Review — PDUFA date typically set within 60 days\n` +
          `⚡ <b>ACTION: Early pipeline signal — 10-12mo runway. Add to research watchlist.</b>`
        );
      }
    }
  } catch(e) { /* silent */ }

  // ── 4. NEW: EMA CHMP POSITIVE OPINIONS (67 days before EC decision) ──
  try {
    const emaURL = `https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json`;
    const r = await fetch(`https://pharma-signal-monitor.vercel.app/api/proxy?url=${encodeURIComponent(emaURL)}`);
    if (r.ok) {
      const data = await r.json();
      const records = data?.data || [];
      const today = new Date();

      for (const rec of records) {
        if (rec.opinion_status !== "Positive") continue;
        const opDate = rec.opinion_adopted_date;
        if (!opDate) continue;

        // Parse DD/MM/YYYY
        const [dd,mm,yyyy] = opDate.split("/");
        const opinionDate = new Date(`${yyyy}-${mm}-${dd}`);
        const daysSinceOpinion = Math.round((today - opinionDate) / 86400000);

        // Alert only on the day it's freshly found (within last 3 days) — avoid spam
        if (daysSinceOpinion >= 0 && daysSinceOpinion <= 3) {
          const ecDecisionEst = new Date(opinionDate); ecDecisionEst.setDate(ecDecisionEst.getDate() + 67);
          const isPrime  = rec.prime_priority_medicine === "Yes" || rec.prime_priority_medicine === "yes";
          const isOrphan = rec.orphan_medicine === "Yes" || rec.orphan_medicine === "yes";

          alerts.push(
            `🇪🇺 <b>CHMP POSITIVE OPINION</b>\n💊 <b>${rec.name_of_medicine || "Unknown"}</b>\n` +
            `🏢 ${rec.marketing_authorisation_developer_applicant_holder || ""}\n` +
            `${isPrime?"⭐ PRIME ":""}${isOrphan?"🏥 Orphan":""}\n` +
            `📅 EC Decision expected: ~${ecDecisionEst.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})} (67 days)\n` +
            `⚡ <b>ACTION: Pre-approval alpha window open NOW. Research before EC formalizes.</b>`
          );
        }
      }
    }
  } catch(e) { /* silent */ }

  // ── 5. SEND ──
  if (alerts.length === 0) {
    const hour = new Date().getUTCHours();
    if (hour === 6) { // 9 AM Athens
      const upcomingPdufa = PDUFA_CALENDAR
        .map(p => ({ ...p, days: daysUntil(p.date) }))
        .filter(p => p.days >= 0 && p.days <= 90)
        .sort((a,b) => a.days - b.days)
        .slice(0,3);

      const summary = upcomingPdufa.map(p =>
        `• <b>${p.drug}</b> (${p.ticker}) — ${p.days === 0 ? "TODAY" : p.days + "d"}`
      ).join("\n");

      await sendTelegram(token, chatId,
        `☀️ <b>Pharma Signal Monitor — Morning Briefing</b>\n\n📅 Next PDUFA decisions:\n${summary}\n\n` +
        `📊 <a href="https://pharma-signal-monitor.vercel.app">Open Signal Monitor</a>`
      );
    }
    return new Response('No alerts', { status: 200 });
  }

  let sent = 0;
  for (const msg of alerts) {
    const ok = await sendTelegram(token, chatId, msg);
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 500));
  }

  return new Response(JSON.stringify({ sent, total: alerts.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}