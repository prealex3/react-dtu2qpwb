// Vercel Cron Job — /api/telegram-alert.js
// Runs every hour, sends Telegram message when new Tier 1 signal < 2h old
// 
// SETUP (5 minuta):
// 1. Telegram: poruka @BotFather → /newbot → daj ime → dobiješ TOKEN
// 2. Poruka @userinfobot → dobiješ tvoj CHAT_ID  
// 3. Vercel Dashboard → Settings → Environment Variables:
//    TELEGRAM_BOT_TOKEN = "123456:ABC-DEF..."
//    TELEGRAM_CHAT_ID   = "123456789"
// 4. Commitaj ovaj fajl → Vercel automatski prepoznaje cron

export const config = {
    runtime: 'edge',
  };
  
  // Vercel Cron schedule — runs every hour
  // Add to vercel.json: { "crons": [{ "path": "/api/telegram-alert", "schedule": "0 * * * *" }] }
  
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
        disable_web_page_preview: false,
      }),
    });
    return r.ok;
  }
  
  function daysUntil(dateStr) {
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(dateStr);
    return Math.round((d - today) / 86400000);
  }
  
  export default async function handler(req) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
  
    if (!token || !chatId) {
      return new Response('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars', { status: 500 });
    }
  
    const alerts = [];
  
    // ── Check PDUFA dates ──
    for (const p of PDUFA_CALENDAR) {
      const days = daysUntil(p.date);
      const dateStr = new Date(p.date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  
      if (days === 30) {
        alerts.push(
          `🟡 <b>PDUFA IN 30 DAYS</b>\n` +
          `💊 <b>${p.drug}</b> (${p.ticker})\n` +
          `📋 ${p.indication}\n` +
          `📅 Decision: ${dateStr}\n` +
          `⚡ <b>ACTION: Build position now. Pre-PDUFA run-up typically starts here.</b>\n` +
          `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
        );
      } else if (days === 7) {
        alerts.push(
          `🔴 <b>PDUFA THIS WEEK — ${days} DAYS</b>\n` +
          `💊 <b>${p.drug}</b> (${p.ticker})\n` +
          `📋 ${p.indication}\n` +
          `📅 Decision: ${dateStr}\n` +
          `⚡ <b>ACTION: Final position sizing. Set stop-loss. FDA can act EARLY — watch daily.</b>\n` +
          `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
        );
      } else if (days === 1) {
        alerts.push(
          `🚨 <b>PDUFA TOMORROW!</b>\n` +
          `💊 <b>${p.drug}</b> (${p.ticker})\n` +
          `📋 ${p.indication}\n` +
          `📅 Decision: ${dateStr}\n` +
          `⚡ <b>CRITICAL: Position must be set NOW. FDA decision expected within 24h.</b>\n` +
          `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
        );
      } else if (days === 0) {
        alerts.push(
          `🚨🚨 <b>PDUFA TODAY — WATCH FDA.GOV</b>\n` +
          `💊 <b>${p.drug}</b> (${p.ticker})\n` +
          `📋 ${p.indication}\n` +
          `⚡ Decision expected TODAY. Check FDA press releases every hour.\n` +
          `🌐 <a href="https://www.fda.gov/news-events/press-announcements">FDA Press Releases</a>\n` +
          `📊 <a href="https://finance.yahoo.com/quote/${p.ticker}">Yahoo Finance: ${p.ticker}</a>`
        );
      }
    }
  
    // ── Check FDA new approvals (openFDA) ──
    try {
      const today = new Date();
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
      
      const fdaURL = `https://api.fda.gov/drug/drugsfda.json?search=submissions.submission_status_date:[${fmt(yesterday)}+TO+${fmt(today)}]+AND+submissions.submission_status:AP&limit=20`;
      const r = await fetch(fdaURL);
      if (r.ok) {
        const data = await r.json();
        const results = data?.results || [];
        for (const app of results) {
          const appNum = app.application_number || "";
          const appType = appNum.slice(0,3);
          if (appType === "AND") continue; // skip generics
          
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
              `🔴 <b>NEW FDA APPROVAL — ${appType}</b>\n` +
              `💊 <b>${name}</b>\n` +
              `🏢 ${app.sponsor_name || ""}\n` +
              `🧪 ${substance.slice(0,80)}\n` +
              `${flags}\n` +
              `⚡ <b>ACTION: Analyse within 24h. Check pharma-signal-monitor.vercel.app</b>`
            );
          }
        }
      }
    } catch(e) {
      // FDA check failed silently
    }
  
    // ── Send all alerts ──
    if (alerts.length === 0) {
      // No alert needed — send daily summary at 8 AM
      const hour = new Date().getUTCHours();
      if (hour === 6) { // 6 UTC = 9 AM Athens
        const upcomingPdufa = PDUFA_CALENDAR
          .map(p => ({ ...p, days: daysUntil(p.date) }))
          .filter(p => p.days >= 0 && p.days <= 90)
          .sort((a,b) => a.days - b.days)
          .slice(0,3);
  
        const summary = upcomingPdufa.map(p => 
          `• <b>${p.drug}</b> (${p.ticker}) — ${p.days === 0 ? "TODAY" : p.days + "d"}`
        ).join("\n");
  
        await sendTelegram(token, chatId,
          `☀️ <b>Pharma Signal Monitor — Morning Briefing</b>\n\n` +
          `📅 Next PDUFA decisions:\n${summary}\n\n` +
          `📊 <a href="https://pharma-signal-monitor.vercel.app">Open Signal Monitor</a>`
        );
      }
      return new Response('No alerts', { status: 200 });
    }
  
    // Send each alert
    let sent = 0;
    for (const msg of alerts) {
      const ok = await sendTelegram(token, chatId, msg);
      if (ok) sent++;
      await new Promise(r => setTimeout(r, 500)); // rate limit
    }
  
    return new Response(JSON.stringify({ sent, total: alerts.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }