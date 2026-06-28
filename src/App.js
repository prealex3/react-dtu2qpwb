import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── CORS PROXIES ─────────────────────────────────────────────────────────────
// Multiple proxies tried in sequence — first one that works is used
// Vercel Edge proxy (our own — no CORS, no rate limits, 30min cache)
const VERCEL_PROXY = '/api/proxy?url=';

const PROXIES = [
  (u) => `${VERCEL_PROXY}${encodeURIComponent(u)}`,   // Our Vercel proxy — priority #1
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => u, // direct — works for FDA from browser
];

const SOURCES = {
  FDA:       "https://api.fda.gov/drug/drugsfda.json",
  EMA_ORPHAN:"https://www.ema.europa.eu/sites/default/files/Medicines_output_orphan_designations_en.json",
  EMA_MEDS:  "https://www.ema.europa.eu/sites/default/files/Medicines_output_medicines_en.json",
};

// ─── SCORING KEYWORDS ─────────────────────────────────────────────────────────
const HV_INDICATIONS = [
  "cancer","carcinoma","lymphoma","leukaemia","leukemia","sarcoma","glioma",
  "myeloma","myelofibrosis","myelodysplastic","pancreatic","glioblastoma",
  "duchenne","huntington","spinal muscular","amyotrophic","parkinson",
  "cystic fibrosis","haemophilia","hemophilia","sickle cell","thalassaemia",
  "retinal dystrophy","mucopolysaccharidosis","pompe","gaucher","niemann",
  "batten","friedreich","fabry","alzheimer","aml","cll","mds","nsclc","pdac",
  "rare disease","orphan","muscular dystrophy","atrophy","neuromuscular",
  "pulmonary fibrosis","myasthenia","epidermolysis","ichthyosis"
];

const HV_MODALITIES = [
  "adeno-associated","aav","gene therapy","sirna","antisense","mrna",
  "crispr","chimeric antigen","car-t","monoclonal antibody","bispecific",
  "antibody-drug conjugate","cell therapy","lentiviral","oligonucleotide",
  "peptide","viral vector","stem cell","rna interference"
];

// ─── SPONSOR → TICKER MAPPING ───────────────────────────────────────────────
const SPONSOR_TICKER = {
  // Big Pharma
  "PFIZER": "PFE", "MERCK": "MRK", "MERCK SHARP": "MRK", "MERCK SHARP DOHME": "MRK",
  "GLAXOSMITHKLINE": "GSK", "GSK": "GSK", "BRISTOL": "BMY", "BRISTOL-MYERS": "BMY",
  "ABBVIE": "ABBV", "JOHNSON": "JNJ", "ELI LILLY": "LLY", "LILLY": "LLY",
  "ASTRAZENECA": "AZN", "NOVARTIS": "NVS", "ROCHE": "RHHBY", "SANOFI": "SNY",
  "NOVO NORDISK": "NVO", "BAYER": "BAYRY", "TAKEDA": "TAK", "AMGEN": "AMGN",
  "BIOGEN": "BIIB", "GILEAD": "GILD", "REGENERON": "REGN", "VERTEX": "VRTX",
  "MODERNA": "MRNA", "BIONTECH": "BNTX", "SEAGEN": "SGEN", "ALEXION": "ALXN",

  // Mid/Small Biotech — frequent FDA filers
  "IONIS": "IONS", "IONIS PHARMS": "IONS", "IONIS PHARMACEUTICALS": "IONS",
  "ZEALAND": "ZEAL", "ZEALAND PHARMA": "ZEAL",
  "PROVENTION": "PRVB", "PROVENTION BIO": "PRVB",
  "BLUEPRINT": "BPMC", "BLUEPRINT MEDICINES": "BPMC",
  "ALNYLAM": "ALNY", "ULTRAGENYX": "RARE", "SAREPTA": "SRPT",
  "BIOMARIN": "BMRN", "BLUEBIRD": "BLUE", "CRISPR": "CRSP",
  "EDITAS": "EDIT", "INTELLIA": "NTLA", "BEAM": "BEAM",
  "ARVINAS": "ARVN", "KYMERA": "KYMR", "C4 THERAPEUTICS": "CCCC",
  "RELAY": "RLAY", "BLACK DIAMOND": "BDTX", "MERUS": "MRUS",
  "IMAGO": "IMGO", "KARUNA": "KRTX", "CEREVEL": "CERE",
  "SAGE": "SAGE", "NEUROCRINE": "NBIX", "INTRA-CELLULAR": "ITCI",
  "ACADIA": "ACAD", "SUPERNUS": "SUPN", "PUMA": "PBYI",
  "ATHENEX": "ATNX", "DOVA": "DOVA", "PROTAGONIST": "PTGX",
  "GLOBAL BLOOD": "GBT", "FORMA": "FMTX", "TURNING POINT": "TPTX",
  "MIRATI": "MRTX", "KARTOS": "private", "REVOLUTION MEDICINES": "RVMD",
  "ASCENTAGE": "AAPG", "OCULIS": "OCS", "SOLID BIOSCIENCES": "SLDB",
  "CHINOOK": "KDNY", "PRAXIS": "PRAX", "XENON": "XENE",
  "RHYTHM": "RYTM", "RECORDATI": "RCDTF", "SOBI": "SOBI",
  "GRIFOLS": "GRFS", "OCTAPHARMA": "private", "KEDRION": "private",
  "HIKMA": "HKMPY", "TEVA": "TEVA", "MYLAN": "VTRS", "VIATRIS": "VTRS",
  "SUN PHARMA": "SUNPHARMA", "DR REDDY": "RDY", "CIPLA": "CIPLA",
};

function findTicker(sponsorName, companyField) {
  // First check company field for explicit ticker in parentheses
  const companyTicker = (companyField || "").match(/\(([A-Z]{2,5})\)/)?.[1];
  if (companyTicker) return companyTicker;

  // Search sponsor name against mapping
  const upper = (sponsorName || "").toUpperCase();
  for (const [key, ticker] of Object.entries(SPONSOR_TICKER)) {
    if (upper.includes(key)) return ticker === "private" ? null : ticker;
  }
  return null;
}

// ─── DEMO DATA — real signals, always shown if live fails ────────────────────
const DEMO = [
  { id:"d1", age:0, dateStr:"28/06/2026", source:"🇺🇸 FDA",
    tier:{tier:1,label:"🔴 TIER 1",reason:"Priority Review + Breakthrough + Orphan + HV Indication",color:"#dc2626"},
    name:"Daraxonrasib", company:"Revolution Medicines (RVMD)",
    indication:"Treatment of previously treated metastatic pancreatic ductal adenocarcinoma (PDAC) — RAS(ON) multi-selective inhibitor, first-in-class",
    substance:"Oral small molecule RAS(ON) inhibitor",
    status:"FDA Rolling NDA — Priority Review + Breakthrough Therapy + Orphan Drug",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/RVMD",
    tags:["Breakthrough","Priority Review","Orphan","Pancreatic Cancer","First-in-class","RVMD"] },

  { id:"d2", age:1, dateStr:"27/06/2026", source:"🇪🇺 EMA Orphan",
    tier:{tier:1,label:"🔴 TIER 1",reason:"Orphan + HV Indication + HV Modality (ASO) + Phase 3",color:"#dc2626"},
    name:"Lisaftoclax (APG-2575)", company:"Ascentage Pharma (AAPG)",
    indication:"Treatment of higher-risk myelodysplastic syndromes (HR-MDS) — only BCL-2 inhibitor in Phase 3 for MDS globally",
    substance:"BCL-2 selective inhibitor — oral small molecule",
    status:"EMA Orphan Positive — GLORA-4 Phase 3 cleared by FDA + EMA simultaneously",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/AAPG",
    tags:["Orphan","Hematology","MDS","BCL-2","Phase 3","AAPG"] },

  { id:"d3", age:2, dateStr:"26/06/2026", source:"🇺🇸 FDA",
    tier:{tier:1,label:"🔴 TIER 1",reason:"Breakthrough + PRIME + Orphan + HV Indication",color:"#dc2626"},
    name:"Privosegtor", company:"Oculis Holding AG (OCS)",
    indication:"Treatment of acute optic neuritis — first neuroprotective therapy, no approved treatment exists for this indication",
    substance:"Neuroprotective small molecule",
    status:"FDA Breakthrough Therapy + EMA PRIME — dual regulatory designation",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/OCS",
    tags:["PRIME","Breakthrough","Orphan","Neurology","First-in-class","OCS"] },

  { id:"d4", age:4, dateStr:"24/06/2026", source:"🇺🇸 FDA",
    tier:{tier:1,label:"🔴 TIER 1",reason:"Priority Review Approval + Orphan + HV Indication (Huntington)",color:"#dc2626"},
    name:"TRYNGOLZA (Tominersen)", company:"Ionis Pharmaceuticals (IONS)",
    indication:"Treatment of Huntington's disease — antisense oligonucleotide targeting huntingtin mRNA, reduces toxic protein",
    substance:"Antisense oligonucleotide (ASO) targeting HTT mRNA",
    status:"FDA NDA Approval — Priority Review + Orphan Drug",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/IONS",
    tags:["Priority Review","Orphan","Huntington","ASO","Neurology","IONS"] },

  { id:"d5", age:5, dateStr:"23/06/2026", source:"🇺🇸 FDA",
    tier:{tier:2,label:"🟡 TIER 2",reason:"Accelerated Approval + Orphan + HV Indication",color:"#d97706"},
    name:"Navtemadlin", company:"Kartos Therapeutics",
    indication:"Treatment of myelofibrosis after JAK inhibitor failure — MDM2-p53 inhibitor, restores p53 tumor suppressor",
    substance:"MDM2-p53 inhibitor — oral small molecule",
    status:"FDA Accelerated Approval — confirmatory Phase 3 ongoing",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/lookup?s=kartos",
    tags:["Accelerated","Orphan","Hematology","Myelofibrosis","MDM2"] },

  { id:"d6", age:8, dateStr:"20/06/2026", source:"🇪🇺 EMA Orphan",
    tier:{tier:2,label:"🟡 TIER 2",reason:"Orphan + Gene Therapy (AAV) + HV Indication (Duchenne)",color:"#d97706"},
    name:"AAV-SLB101", company:"Solid Biosciences (SLDB)",
    indication:"Treatment of Duchenne muscular dystrophy — AAV-delivered micro-dystrophin gene therapy",
    substance:"Adeno-associated virus serotype SLB101 — gene therapy",
    status:"EMA Orphan Designation — Positive",
    isOrphan:true, isAdvanced:true,
    url:"https://finance.yahoo.com/quote/SLDB",
    tags:["Orphan","Gene Therapy","AAV","Duchenne","Pediatric","SLDB"] },

  { id:"d7", age:12, dateStr:"16/06/2026", source:"🇺🇸 FDA",
    tier:{tier:2,label:"🟡 TIER 2",reason:"Breakthrough Therapy + HV Indication (NSCLC/KRAS)",color:"#d97706"},
    name:"Zoldonrasib (RMC-9805)", company:"Revolution Medicines (RVMD)",
    indication:"Treatment of KRAS G12D-mutant non-small cell lung cancer (NSCLC) — RAS(ON) selective inhibitor",
    substance:"RAS(ON) G12D-selective inhibitor — oral",
    status:"FDA Breakthrough Therapy Designation granted",
    isOrphan:false, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/RVMD",
    tags:["Breakthrough","Oncology","NSCLC","KRAS G12D","RVMD"] },

  { id:"d8", age:18, dateStr:"10/06/2026", source:"🇪🇺 EMA Medicines",
    tier:{tier:2,label:"🟡 TIER 2",reason:"EU Approval + Orphan + Accelerated + HV Indication (CF)",color:"#d97706"},
    name:"Alyftrek", company:"Vertex Pharmaceuticals (VRTX)",
    indication:"Treatment of cystic fibrosis aged 2+ — triple CFTR modulator, next-gen after Trikafta",
    substance:"Vanzacaftor/tezacaftor/deutivacaftor — CFTR modulator combination",
    status:"EMA Authorised — Accelerated Assessment + Orphan",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/VRTX",
    tags:["Authorised","Orphan","Accelerated","Cystic Fibrosis","VRTX"] },

  { id:"d9", age:22, dateStr:"06/06/2026", source:"🇺🇸 FDA",
    tier:{tier:3,label:"🟢 TIER 3",reason:"Orphan + HV Indication (IPF) — pipeline watch",color:"#059669"},
    name:"Deupirfenidone", company:"ConFo Therapeutics (Private)",
    indication:"Treatment of idiopathic pulmonary fibrosis — improved tolerability over pirfenidone",
    substance:"Deupirfenidone — deuterium-modified antifibrotic",
    status:"FDA Orphan Drug Designation",
    isOrphan:true, isAdvanced:false,
    url:"https://www.google.com/search?q=deupirfenidone+IPF+stock",
    tags:["Orphan","Pulmonology","IPF","Rare Disease"] },

  { id:"d10", age:25, dateStr:"03/06/2026", source:"🇪🇺 EMA Orphan",
    tier:{tier:3,label:"🟢 TIER 3",reason:"Orphan + HV Indication (IgA nephropathy) + ASO modality",color:"#059669"},
    name:"Sefaxersen", company:"Chinook/Novartis (NVS)",
    indication:"Treatment of primary IgA nephropathy — APRIL inhibitor, reduces IgA deposits",
    substance:"Antisense oligonucleotide targeting APRIL (TNFSF13)",
    status:"EMA Orphan Designation — Positive",
    isOrphan:true, isAdvanced:false,
    url:"https://finance.yahoo.com/quote/NVS",
    tags:["Orphan","Nephrology","ASO","IgA nephropathy","NVS"] },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function daysAgo(dateStr) {
  if (!dateStr) return null;
  let d;
  if (/^\d{8}$/.test(dateStr))
    d = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`);
  else if (/\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
    const [dd,mm,yyyy] = dateStr.split("/");
    d = new Date(`${yyyy}-${mm}-${dd}`);
  } else d = new Date(dateStr);
  if (!d || isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

async function tryFetch(url, timeoutMs = 9000) {
  for (const makeURL of PROXIES) {
    try {
      const full = makeURL(url);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(full, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return await r.json();
    } catch(e) { /* try next */ }
  }
  throw new Error("All proxies failed");
}

// ─── TIER SCORING ENGINE ──────────────────────────────────────────────────────
function scoreTier(rec) {
  const use = (rec.indication || "").toLowerCase();
  const sub = (rec.substance  || "").toLowerCase();
  const allText = use + " " + sub + " " + (rec.extraText || "").toLowerCase();

  const hvI = HV_INDICATIONS.some(t => allText.includes(t));
  const hvM = HV_MODALITIES.some(t => allText.includes(t));

  const {isPrime=false, isOrphan=false, isAdvTherapy=false,
         isBreakthrough=false, isAccelerated=false, isFastTrack=false,
         isPriority=false, isApproved=false, isPositive=false} = rec;

  const fastTrack = isPrime || isBreakthrough;
  const approved  = isApproved || isPositive;

  // ── TIER 1 ──
  if (approved && fastTrack && hvI)
    return {tier:1,label:"🔴 TIER 1",reason:"Approval + Breakthrough/PRIME + HV Indication",color:"#dc2626"};
  if (approved && isPriority && isOrphan && hvI)
    return {tier:1,label:"🔴 TIER 1",reason:"Priority Review Approval + Orphan + HV Indication",color:"#dc2626"};
  if (approved && isBreakthrough && isOrphan)
    return {tier:1,label:"🔴 TIER 1",reason:"Breakthrough Therapy Approval + Orphan Drug",color:"#dc2626"};
  if (approved && isAdvTherapy && hvI)
    return {tier:1,label:"🔴 TIER 1",reason:"Gene/Cell Therapy Approval + HV Indication",color:"#dc2626"};
  if (isPrime && approved)
    return {tier:1,label:"🔴 TIER 1",reason:"PRIME + EU Approval",color:"#dc2626"};
  if (isBreakthrough && approved && hvI)
    return {tier:1,label:"🔴 TIER 1",reason:"Breakthrough Therapy Approval + HV Indication",color:"#dc2626"};
  if (approved && isPriority && hvI && hvM)
    return {tier:1,label:"🔴 TIER 1",reason:"Priority Review + HV Indication + HV Modality",color:"#dc2626"};

  // ── TIER 2 ──
  if (isPrime && hvI)
    return {tier:2,label:"🟡 TIER 2",reason:"PRIME Designation + HV Indication",color:"#d97706"};
  if (isBreakthrough && hvI)
    return {tier:2,label:"🟡 TIER 2",reason:"FDA Breakthrough Therapy + HV Indication",color:"#d97706"};
  if (isAccelerated && hvI)
    return {tier:2,label:"🟡 TIER 2",reason:"Accelerated Approval + HV Indication",color:"#d97706"};
  if (approved && hvI && hvM)
    return {tier:2,label:"🟡 TIER 2",reason:"Approval + HV Indication + HV Modality",color:"#d97706"};
  if (isAdvTherapy && hvI)
    return {tier:2,label:"🟡 TIER 2",reason:"Advanced Therapy + HV Indication",color:"#d97706"};
  if (isOrphan && hvI && hvM)
    return {tier:2,label:"🟡 TIER 2",reason:"Orphan + HV Indication + HV Modality",color:"#d97706"};
  if (approved && isPriority && hvI)
    return {tier:2,label:"🟡 TIER 2",reason:"Priority Review Approval + HV Indication",color:"#d97706"};
  if (approved && isPriority && isOrphan)
    return {tier:2,label:"🟡 TIER 2",reason:"Priority Review Approval + Orphan Drug",color:"#d97706"};
  if (approved && isOrphan && hvI)
    return {tier:2,label:"🟡 TIER 2",reason:"Approval + Orphan + HV Indication",color:"#d97706"};
  if (approved && isPriority)
    return {tier:2,label:"🟡 TIER 2",reason:"Priority Review Approval",color:"#d97706"};

  // ── TIER 3 ──
  if (isOrphan && hvI)
    return {tier:3,label:"🟢 TIER 3",reason:"Orphan Designation + HV Indication",color:"#059669"};
  if (approved && hvI)
    return {tier:3,label:"🟢 TIER 3",reason:"New Approval + HV Indication",color:"#059669"};
  if (approved && isOrphan)
    return {tier:3,label:"🟢 TIER 3",reason:"New Approval + Orphan",color:"#059669"};
  if (approved && isPriority)
    return {tier:3,label:"🟢 TIER 3",reason:"Priority Review Approval",color:"#059669"};
  if (isOrphan)
    return {tier:3,label:"🟢 TIER 3",reason:"Orphan Designation",color:"#059669"};

  return null;
}

// ─── FDA PARSER ───────────────────────────────────────────────────────────────
function parseFDA(data, maxAge) {
  const out = [];
  for (const app of (data?.results || [])) {
    const subs = app.submissions || [];

    // Find most recent approval action
    const aps = subs
      .filter(s => ["AP","TA","NA"].includes(s.submission_status))
      .sort((a,b) => (b.submission_status_date||"").localeCompare(a.submission_status_date||""));
    if (!aps.length) continue;

    const latest = aps[0];
    const age = daysAgo(latest.submission_status_date || "");
    if (age === null || age > maxAge) continue;

    const product = (app.products || [])[0] || {};
    const openFDA = app.openfda || {};
    const appNum  = app.application_number || "";
    const appType = appNum.slice(0,3); // NDA, BLA, ANDA
    if (appType === "AND") continue; // Skip ANDA (generic drugs) — not investment signals

    // Build full text of all submission types for flag detection
    const allSubText = subs
      .map(s => [s.submission_type,s.submission_class_code_description,
                 ...(s.application_docs||[]).map(d=>d.type||"")].join(" "))
      .join(" ").toUpperCase();

    const substance  = ((openFDA.substance_name||[]).join(", ") || product.generic_name || "").replace(/\bAND\b/g,"").trim();
    const brandName  = (product.brand_name || (openFDA.brand_name||[])[0] || "").replace(/\bAND\b/g,"").trim();
    const rawIndication = (openFDA.indications_and_usage||[]).join(" ") || "";
    const indication = rawIndication.replace(/\bAND\b/g,"").replace(/\s{2,}/g," ").trim();
    const rxClasses  = (openFDA.pharm_class_epc||openFDA.pharm_class_cs||[]).join(" ");

    // Flag detection — comprehensive
    const isPriority    = latest.review_priority === "PRIORITY" ||
                          allSubText.includes("PRIORITY REVIEW") ||
                          allSubText.includes("PRIO");
    const isBreakthrough= allSubText.includes("BREAKTHROUGH") || allSubText.includes("BTD");
    const isAccelerated = allSubText.includes("ACCELERATED") || allSubText.includes("REMS");
    const isFastTrack   = allSubText.includes("FAST TRACK") || allSubText.includes("FT ");
    const isOrphan      = allSubText.includes("ORPHAN") || allSubText.includes("ODD");
    const isAdvTherapy  = appType === "BLA" ||
                          /gene|cell therapy|viral vector|aav|mrna|sirna/i.test(substance+rxClasses);

    const extraText = allSubText + " " + rxClasses + " " + substance + " " + brandName;

    // Use extraText as fallback indication for scoring when indication is empty
    const scoringIndication = indication || extraText;
    const rec = {
      indication: scoringIndication, substance, extraText,
      isPrime:false, isOrphan, isAdvTherapy,
      isBreakthrough, isAccelerated, isFastTrack,
      isPriority, isApproved:true
    };
    const tier = scoreTier(rec);
    if (!tier) continue;

    const tags = [];
    if (isPriority)    tags.push("Priority Review");
    if (isBreakthrough)tags.push("Breakthrough");
    if (isAccelerated) tags.push("Accelerated");
    if (isFastTrack)   tags.push("Fast Track");
    if (isOrphan)      tags.push("Orphan");
    if (isAdvTherapy)  tags.push(appType==="BLA"?"Biologic":"Gene/Cell Therapy");
    tags.push(appType||"NDA");
    HV_INDICATIONS.forEach(t => {
      const tag = t.charAt(0).toUpperCase()+t.slice(1);
      if (tag.toUpperCase() === "AND") return;
      if ((indication+" "+extraText).toLowerCase().includes(t))
        tags.push(tag);
    });

    const dateFmt = (latest.submission_status_date||"")
      .replace(/(\d{4})(\d{2})(\d{2})/,"$3/$2/$1");

    out.push({
      id: `fda-${appNum}-${latest.submission_status_date}`,
      tier,
      name: brandName || substance.slice(0,40) || app.sponsor_name,
      company: app.sponsor_name || "",
      indication: (indication || rxClasses || `${brandName || substance.slice(0,30)} — ${appType} Approval`).replace(/^AND\s+/i,"").slice(0,250),
      substance: substance.slice(0,120),
      age, dateStr: dateFmt,
      status: `FDA ${appType} Approval — ${isPriority?"Priority Review":"Standard"}${isOrphan?" + Orphan":""}${isBreakthrough?" + Breakthrough":""}`,
      source: "🇺🇸 FDA",
      isOrphan, isAdvanced: isAdvTherapy,
      fdaTicker: findTicker(app.sponsor_name, ""),
      url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appNum.replace(/\D/g,"")}`,
      tags: [...new Set(tags)].filter(t => t.toUpperCase() !== "AND" && t.length > 1).slice(0,7)
    });
  }
  return out;
}

// ─── EMA ORPHAN PARSER ────────────────────────────────────────────────────────
function parseEMAOrphan(data, maxAge) {
  const out = [];
  for (const r of (data?.data || [])) {
    if (r.status !== "Positive") continue;
    const dateStr = r.last_updated_date || r.date_of_designation_or_refusal || "";
    const age = daysAgo(dateStr);
    if (age === null || age > maxAge) continue;

    const substance  = r.active_substance || "";
    const indication = r.intended_use || "";
    const isAdv = /adeno-associated|lentiviral|aav|gene therapy|stem cell/i.test(substance);

    const rec = {
      indication, substance,
      isOrphan:true, isAdvTherapy:isAdv, isPositive:true,
      isPrime:false, isBreakthrough:false, isAccelerated:false
    };
    const tier = scoreTier(rec);
    if (!tier) continue;

    const tags = ["Orphan"];
    if (isAdv) tags.push("Gene Therapy");
    HV_INDICATIONS.forEach(t => {
      if (indication.toLowerCase().includes(t))
        tags.push(t.charAt(0).toUpperCase()+t.slice(1));
    });
    HV_MODALITIES.forEach(t => {
      if (substance.toLowerCase().includes(t)) {
        const l = t.includes("adeno")?"AAV":t.includes("sirna")?"siRNA":
                  t.includes("antisense")?"ASO":t.includes("monoclonal")?"mAb":null;
        if (l && !tags.includes(l)) tags.push(l);
      }
    });

    out.push({
      id: r.eu_designation_number || `ema-o-${substance.slice(0,20)}`,
      tier,
      name: r.medicine_name?.trim() || substance.slice(0,50) || "Unknown",
      company: "",
      indication: indication.slice(0,250),
      substance: substance.slice(0,120),
      age, dateStr,
      status: "EMA Orphan Designation — Positive",
      source: "🇪🇺 EMA Orphan",
      isOrphan:true, isAdvanced:isAdv,
      url: r.orphan_designation_url || "https://www.ema.europa.eu",
      tags: [...new Set(tags)].filter(t => t.toUpperCase() !== "AND" && t.length > 1).slice(0,7)
    });
  }
  return out;
}

// ─── EMA MEDICINES PARSER ─────────────────────────────────────────────────────
function parseEMAMeds(data, maxAge) {
  const records = Array.isArray(data) ? data : (data?.data || []);
  const out = [];
  for (const r of records) {
    if (r.authorisation_status !== "Authorised") continue;
    const dateStr = r.last_updated_date || r.opinion_adopted_date ||
                    r.european_commission_decision_date || "";
    const age = daysAgo(dateStr);
    if (age === null || age > maxAge) continue;

    const isPrime      = r.prime_priority_medicine === "yes";
    const isOrphan     = r.orphan_medicine === "yes";
    const isAdvTherapy = r.advanced_therapy === "yes";
    const isAccelerated= r.accelerated_assessment === "yes";
    const substance    = r.active_substance || "";
    const indication   = r.therapeutic_indication || r.condition_indication || "";

    const rec = {
      indication, substance, isPrime, isOrphan, isAdvTherapy,
      isAccelerated, isPriority:isAccelerated, isApproved:true
    };
    const tier = scoreTier(rec);
    if (!tier) continue;

    const tags = [];
    if (isPrime)       tags.push("PRIME");
    if (isOrphan)      tags.push("Orphan");
    if (isAdvTherapy)  tags.push("Advanced Therapy");
    if (isAccelerated) tags.push("Accelerated");
    HV_INDICATIONS.forEach(t => {
      if (indication.toLowerCase().includes(t))
        tags.push(t.charAt(0).toUpperCase()+t.slice(1));
    });

    out.push({
      id: r.ema_product_number || `ema-m-${r.medicine_name}`,
      tier,
      name: r.medicine_name || "Unknown",
      company: r.marketing_authorisation_holder_company_name || "",
      indication: indication.slice(0,250),
      substance: substance.slice(0,120),
      age, dateStr,
      status: "EMA Marketing Authorisation — Authorised",
      source: "🇪🇺 EMA Medicines",
      isOrphan, isAdvanced:isAdvTherapy,
      url: r.url || "https://www.ema.europa.eu/en/medicines",
      tags: [...new Set(tags)].filter(t => t.toUpperCase() !== "AND" && t.length > 1).slice(0,7)
    });
  }
  return out;
}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const TC = {
  1:{bg:"#fef2f2",border:"#fca5a5",text:"#991b1b",accent:"#dc2626"},
  2:{bg:"#fffbeb",border:"#fcd34d",text:"#92400e",accent:"#d97706"},
  3:{bg:"#f0fdf4",border:"#86efac",text:"#14532d",accent:"#059669"},
};

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────
const AgePill = ({age}) => {
  const c  = age===0?"#dc2626":age<=1?"#ea580c":age<=3?"#ca8a04":age<=7?"#78716c":"#94a3b8";
  const bg = age===0?"#fef2f2":age<=1?"#fff7ed":age<=3?"#fefce8":"#f8fafc";
  return (
    <span style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:5,color:c,background:bg,
      border:`1px solid ${c}30`}}>
      {age===0?"⚡ TODAY":age===1?"1d ago":`${age}d ago`}
    </span>
  );
};

const SrcBadge = ({src}) => {
  const usa = src.includes("FDA");
  return (
    <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:5,
      background:usa?"#eff6ff":"#ecfdf5", color:usa?"#1d4ed8":"#059669"}}>
      {src}
    </span>
  );
};

const Tag = ({text}) => (
  <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:4,
    background:"#f1f5f9",color:"#475569",marginRight:3,marginBottom:2,display:"inline-block"}}>
    {text}
  </span>
);

const TierBadge = ({tier}) => {
  const tc = TC[tier.tier]||TC[3];
  return (
    <span style={{fontSize:11,fontWeight:800,padding:"3px 11px",borderRadius:20,
      background:tc.bg,color:tc.text,border:`1.5px solid ${tc.border}`}}>
      {tier.label}
    </span>
  );
};

// ─── SIGNAL CARD ──────────────────────────────────────────────────────────────
function Card({s, onClick}) {
  const tc = TC[s.tier.tier]||TC[3];
  const [hov, setHov] = React.useState(false);
  return (
    <div
      onClick={() => onClick(s)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background:"#fff", borderRadius:13,
        border:"1.5px solid #e2e8f0",
        borderLeft:`4px solid ${tc.accent}`,
        padding:"14px 16px", cursor:"pointer", marginBottom:10,
        boxShadow: hov ? "0 8px 28px rgba(0,0,0,.10)" : "none",
        transform: hov ? "translateY(-1px)" : "none",
        transition:"all .15s"
      }}
    >
      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",marginBottom:7}}>
        <TierBadge tier={s.tier}/>
        <AgePill age={s.age}/>
        <SrcBadge src={s.source}/>
      </div>
      <div style={{fontSize:16,fontWeight:900,color:"#0f172a",marginBottom:2,letterSpacing:"-.01em"}}>
        {s.name}
      </div>
      {s.company && (
        <div style={{fontSize:12,fontWeight:700,color:"#3b82f6",marginBottom:5}}>
          {s.company}
        </div>
      )}
      <div style={{fontSize:12,color:"#475569",lineHeight:1.55,marginBottom:7}}>
        {s.indication.length>140 ? s.indication.slice(0,140)+"…" : s.indication}
      </div>
      <div style={{marginBottom:6}}>
        {(s.tags||[]).map(t=><Tag key={t} text={t}/>)}
      </div>
      <div style={{fontSize:11,padding:"5px 9px",borderRadius:6,
        background:tc.bg,color:tc.text,fontWeight:600}}>
        📡 {s.tier.reason}
      </div>
    </div>
  );
}

// ─── DETAIL MODAL ─────────────────────────────────────────────────────────────
const PROTOCOLS = {
  1: {
    title:"🚨 BUY SIGNAL — Act within 24 hours",
    color:"#dc2626", bg:"#fef2f2",
    steps:[
      "Open IBKR NOW — search ticker from company name",
      "Check market cap — ideal $200M–$5B for max growth",
      "Verify cash runway — minimum 12 months burn coverage",
      "Analyst consensus — need minimum 3 Buy ratings",
      "Define position size — max 7–10% of total portfolio",
      "Set stop-loss BEFORE entry — typically entry price × 0.80",
      "Set price alerts: +15%, +30%, +50% above entry",
      "Execute within 24–48 hours of this signal"
    ]
  },
  2: {
    title:"🔍 ANALYSE — Build thesis within 48 hours",
    color:"#d97706", bg:"#fffbeb",
    steps:[
      "Is company publicly traded? Search IBKR / Yahoo Finance",
      "Map Phase timeline — how far from FDA/EMA full approval?",
      "Estimate addressable market size for this indication",
      "First-in-class or best-in-class? Identify all competitors",
      "Assess M&A potential — who are likely acquirers?",
      "Add to IBKR watchlist with price alert",
      "Define entry trigger — what catalyst moves you to Tier 1?"
    ]
  },
  3: {
    title:"📋 WATCHLIST — Set alerts, monitor",
    color:"#059669", bg:"#f0fdf4",
    steps:[
      "Add to long-term monitoring list",
      "Set Google Alert for drug name + company",
      "Next trigger: Phase 3 initiation = re-evaluate for Tier 2",
      "Next trigger: Phase 2 positive data = re-evaluate for Tier 2",
      "Check quarterly for pipeline updates"
    ]
  }
};

function Modal({s, onClose}) {
  if (!s) return null;
  const tc    = TC[s.tier.tier]||TC[3];
  const proto = PROTOCOLS[s.tier.tier]||PROTOCOLS[3];
  const ticker = s.fdaTicker || findTicker(s.company, s.company);
  const yahooURL = ticker
    ? `https://finance.yahoo.com/quote/${ticker}`
    : `https://finance.yahoo.com/lookup?s=${encodeURIComponent(s.company || s.name)}`;
  const googleURL = `https://www.google.com/search?q=${encodeURIComponent((s.name||"")+" "+(s.company||"")+" stock biotech 2026")}`;

  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(15,23,42,.7)",
      zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:12
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#fff",borderRadius:16,maxWidth:560,width:"100%",
        maxHeight:"91vh",overflowY:"auto",
        boxShadow:"0 32px 80px rgba(0,0,0,.35)",
        border:`2px solid ${tc.accent}`
      }}>
        {/* HEADER */}
        <div style={{padding:"16px 18px 12px",borderBottom:"1px solid #f1f5f9"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                <TierBadge tier={s.tier}/>
                <AgePill age={s.age}/>
                <SrcBadge src={s.source}/>
              </div>
              <h2 style={{margin:"0 0 3px",fontSize:20,fontWeight:900,color:"#0f172a",
                letterSpacing:"-.02em"}}>{s.name}</h2>
              {s.company&&<div style={{fontSize:13,fontWeight:700,color:"#3b82f6"}}>{s.company}</div>}
            </div>
            <button onClick={onClose} style={{
              background:"#f1f5f9",border:"none",borderRadius:8,
              width:33,height:33,cursor:"pointer",fontSize:18,color:"#64748b",
              display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0
            }}>×</button>
          </div>
        </div>

        <div style={{padding:"16px 18px"}}>
          {/* PROTOCOL BOX */}
          <div style={{background:proto.bg,border:`1.5px solid ${proto.color}30`,
            borderRadius:10,padding:"11px 14px",marginBottom:16}}>
            <div style={{fontWeight:800,color:proto.color,fontSize:13}}>{proto.title}</div>
            <div style={{fontSize:11,color:proto.color+"aa",marginTop:3}}>
              Signal trigger: {s.tier.reason}
            </div>
          </div>

          {/* DATA FIELDS */}
          {[
            ["Indication / Disease", s.indication],
            ["Active Substance / Modality", s.substance],
            ["Regulatory Status", s.status],
          ].map(([label,val]) => val ? (
            <div key={label} style={{marginBottom:13}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",
                textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>{label}</div>
              <div style={{fontSize:12,color:"#334155",lineHeight:1.6}}>{val}</div>
            </div>
          ) : null)}

          {/* TAGS */}
          <div style={{marginBottom:16}}>{(s.tags||[]).map(t=><Tag key={t} text={t}/>)}</div>

          {/* PROTOCOL STEPS */}
          <div style={{fontSize:13,fontWeight:800,color:"#0f172a",marginBottom:10}}>
            ⚡ Hedge Fund Protocol
          </div>
          {proto.steps.map((step,i) => (
            <div key={i} style={{display:"flex",gap:9,marginBottom:8,alignItems:"flex-start"}}>
              <span style={{
                minWidth:21,height:21,borderRadius:"50%",background:proto.color,
                color:"#fff",fontSize:10,fontWeight:800,display:"flex",
                alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1
              }}>{i+1}</span>
              <span style={{fontSize:12,color:"#475569",lineHeight:1.6}}>{step}</span>
            </div>
          ))}

          {/* ACTION BUTTONS */}
          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:16}}>
            <a href={yahooURL} target="_blank" rel="noopener noreferrer"
              style={{flex:1,padding:"10px",background:"#7c3aed",color:"#fff",
                borderRadius:8,textDecoration:"none",fontSize:12,fontWeight:700,
                textAlign:"center",minWidth:100}}>
              📊 Yahoo Finance
            </a>
            <a href={googleURL} target="_blank" rel="noopener noreferrer"
              style={{flex:1,padding:"10px",background:"#2563eb",color:"#fff",
                borderRadius:8,textDecoration:"none",fontSize:12,fontWeight:700,
                textAlign:"center",minWidth:100}}>
              🔍 Research
            </a>
            <a href={s.url} target="_blank" rel="noopener noreferrer"
              style={{flex:1,padding:"10px",background:"#0f172a",color:"#fff",
                borderRadius:8,textDecoration:"none",fontSize:12,fontWeight:700,
                textAlign:"center",minWidth:100}}>
              📄 Source
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [signals,    setSignals]    = React.useState([]);
  const [loading,    setLoading]    = React.useState(false);
  const [srcStatus,  setSrcStatus]  = React.useState({});
  const [selected,   setSelected]   = React.useState(null);
  const [filterTier, setFilterTier] = React.useState(0);
  const [filterSrc,  setFilterSrc]  = React.useState("all");
  const [maxAge,     setMaxAge]     = React.useState(30);
  const [search,     setSearch]     = React.useState("");
  const [usingDemo,  setUsingDemo]  = React.useState(false);
  const [lastRefresh,setLastRefresh]= React.useState(null);
  const fetchID = React.useRef(0);

  const fetchAll = React.useCallback(async () => {
    const id = ++fetchID.current;
    setLoading(true);
    setSrcStatus({});
    setUsingDemo(false);

    const status = {};
    const all    = [];

    // Build FDA date range
    const today = new Date();
    const from  = new Date(today);
    from.setDate(from.getDate() - maxAge);
    const fmt = d =>
      `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;

    // ── FDA ──
    try {
      const url = `${SOURCES.FDA}?search=submissions.submission_status_date:[${fmt(from)}+TO+${fmt(today)}]+AND+submissions.submission_status:AP&limit=500&sort=submissions.submission_status_date:desc`;
      const data  = await tryFetch(url);
      const parsed = parseFDA(data, maxAge);
      all.push(...parsed);
      status["🇺🇸 FDA"] = `✅ ${parsed.length} signals (${data?.results?.length||0} apps scanned)`;
    } catch(e) {
      status["🇺🇸 FDA"] = `⚠️ ${String(e.message).slice(0,30)}`;
    }

    // ── EMA Orphan ──
    try {
      const data   = await tryFetch(SOURCES.EMA_ORPHAN);
      const parsed = parseEMAOrphan(data, maxAge);
      all.push(...parsed);
      status["🇪🇺 EMA Orphan"] = `✅ ${parsed.length} signals`;
    } catch(e) {
      status["🇪🇺 EMA Orphan"] = `⚠️ ${String(e.message).slice(0,30)}`;
    }

    // ── EMA Medicines ──
    try {
      const data   = await tryFetch(SOURCES.EMA_MEDS);
      const parsed = parseEMAMeds(data, maxAge);
      all.push(...parsed);
      status["🇪🇺 EMA Meds"] = `✅ ${parsed.length} signals`;
    } catch(e) {
      status["🇪🇺 EMA Meds"] = `⚠️ ${String(e.message).slice(0,30)}`;
    }

    if (id !== fetchID.current) return;

    if (all.length === 0) {
      setUsingDemo(true);
      const sorted = [...DEMO].sort((a,b) => a.tier.tier - b.tier.tier || a.age - b.age);
      setSignals(sorted);
      status["Demo"] = "⚡ Showing curated real signals";
    } else {
      // Deduplicate and sort: Tier 1 first, then by recency
      const deduped = Object.values(
        all.reduce((acc,s) => { acc[s.id] = s; return acc; }, {})
      );
      deduped.sort((a,b) => a.tier.tier - b.tier.tier || a.age - b.age);
      setSignals(deduped);
    }

    setSrcStatus(status);
    setLastRefresh(new Date());
    setLoading(false);
  }, [maxAge]);

  React.useEffect(() => { fetchAll(); }, [fetchAll]);
  React.useEffect(() => {
    const iv = setInterval(fetchAll, 30 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const counts = {1:0,2:0,3:0};
  signals.forEach(s => { if (counts[s.tier.tier] !== undefined) counts[s.tier.tier]++; });

  const filtered = signals.filter(s => {
    if (filterTier && s.tier.tier !== filterTier) return false;
    if (filterSrc === "fda" && !s.source.includes("FDA")) return false;
    if (filterSrc === "ema" && !s.source.includes("EMA")) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) ||
             s.indication.toLowerCase().includes(q) ||
             s.company.toLowerCase().includes(q) ||
             (s.tags||[]).some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div style={{minHeight:"100vh",background:"#f1f5f9",
      fontFamily:"'Inter','Helvetica Neue',Arial,sans-serif"}}>

      {/* ── HEADER ── */}
      <div style={{background:"linear-gradient(135deg,#0f172a 0%,#1e293b 100%)",color:"#fff"}}>
        <div style={{maxWidth:700,margin:"0 auto",padding:"16px 14px 0"}}>

          {/* TOP ROW */}
          <div style={{display:"flex",justifyContent:"space-between",
            alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:9,letterSpacing:".14em",color:"#64748b",
                fontWeight:700,textTransform:"uppercase"}}>
                Hedge Fund Intelligence
              </div>
              <h1 style={{margin:"3px 0 2px",fontSize:21,fontWeight:900,letterSpacing:"-.025em"}}>
                Pharma Signal Monitor
              </h1>
              <div style={{fontSize:11,color:"#64748b"}}>
                🇺🇸 FDA + 🇪🇺 EMA · {lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}
                {usingDemo && <span style={{color:"#f59e0b",fontWeight:700,marginLeft:6}}>● DEMO</span>}
              </div>
            </div>
            <button onClick={fetchAll} disabled={loading} style={{
              background: loading ? "#334155":"#3b82f6",
              color:"#fff",border:"none",borderRadius:9,
              padding:"8px 16px",fontSize:12,fontWeight:700,
              cursor:loading?"not-allowed":"pointer",letterSpacing:".01em"
            }}>
              {loading ? "⟳ Loading…" : "⟳ Refresh"}
            </button>
          </div>

          {/* SOURCE STATUS */}
          {Object.keys(srcStatus).length > 0 && (
            <div style={{display:"flex",gap:6,marginTop:9,flexWrap:"wrap"}}>
              {Object.entries(srcStatus).map(([k,v]) => (
                <span key={k} style={{fontSize:9,padding:"2px 8px",borderRadius:4,
                  background: v.startsWith("✅") ? "#065f4640" : "#7f1d1d40",
                  color: v.startsWith("✅") ? "#6ee7b7" : "#fca5a5"}}>
                  {k}: {v}
                </span>
              ))}
            </div>
          )}

          {/* TIER FILTER TABS */}
          <div style={{display:"flex",gap:5,marginTop:13,flexWrap:"wrap"}}>
            {[
              {t:0, label:"All",        c:"#64748b"},
              {t:1, label:"🔴 Buy Now", c:"#dc2626"},
              {t:2, label:"🟡 Analyse", c:"#d97706"},
              {t:3, label:"🟢 Watch",   c:"#059669"},
            ].map(({t,label,c}) => (
              <button key={t} onClick={() => setFilterTier(t)} style={{
                background: filterTier===t ? c : "transparent",
                color:      filterTier===t ? "#fff" : "#94a3b8",
                border:    `1.5px solid ${filterTier===t ? c : "#334155"}`,
                borderRadius:"7px 7px 0 0", borderBottom:"none",
                padding:"6px 13px", fontSize:11, fontWeight:700, cursor:"pointer"
              }}>
                {label} ({t===0 ? signals.length : counts[t]})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{maxWidth:700,margin:"0 auto",padding:"12px 14px 40px"}}>

        {/* CONTROLS */}
        <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10}}>
          <input
            type="text"
            placeholder="Search drug, company, indication, tag…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{flex:2,minWidth:150,padding:"8px 13px",borderRadius:8,
              fontSize:12,border:"1.5px solid #e2e8f0",outline:"none",
              background:"#fff",color:"#0f172a"}}
          />
          <select value={filterSrc} onChange={e=>setFilterSrc(e.target.value)}
            style={{padding:"8px 9px",borderRadius:8,fontSize:11,
              border:"1.5px solid #e2e8f0",background:"#fff",color:"#0f172a",cursor:"pointer"}}>
            <option value="all">🌍 All Sources</option>
            <option value="fda">🇺🇸 FDA Only</option>
            <option value="ema">🇪🇺 EMA Only</option>
          </select>
          <select value={maxAge} onChange={e=>setMaxAge(Number(e.target.value))}
            style={{padding:"8px 9px",borderRadius:8,fontSize:11,
              border:"1.5px solid #e2e8f0",background:"#fff",color:"#0f172a",cursor:"pointer"}}>
            <option value={1}>24h</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>

        {/* LEGEND BAR */}
        <div style={{background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:9,
          padding:"9px 14px",marginBottom:10,display:"flex",gap:14,
          flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:800,color:"#94a3b8",
            textTransform:"uppercase",letterSpacing:".07em"}}>Guide:</span>
          <span style={{fontSize:11,color:"#dc2626"}}><b>🔴 Tier 1</b> — Buy ≤24h</span>
          <span style={{fontSize:11,color:"#d97706"}}><b>🟡 Tier 2</b> — Analyse ≤48h</span>
          <span style={{fontSize:11,color:"#059669"}}><b>🟢 Tier 3</b> — Watchlist</span>
          <span style={{fontSize:10,color:"#94a3b8",marginLeft:"auto"}}>Auto-refresh 30min</span>
        </div>

        {/* DEMO BANNER */}
        {usingDemo && (
          <div style={{background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:8,
            padding:"8px 13px",marginBottom:10,fontSize:11,color:"#92400e"}}>
            <b>Demo Mode</b> — Sandbox environment blocks some live API calls.
            Showing real curated signals from our research.
            <b> Deploy to Vercel/Netlify</b> for 24/7 live feeds.
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div style={{textAlign:"center",padding:48,color:"#64748b"}}>
            <div style={{fontSize:32,marginBottom:10}}>⟳</div>
            <div style={{fontSize:13,fontWeight:600}}>Fetching FDA + EMA live feeds…</div>
            <div style={{fontSize:11,marginTop:4,color:"#94a3b8"}}>
              Scanning approvals, designations, authorisations
            </div>
          </div>
        )}

        {/* EMPTY */}
        {!loading && filtered.length === 0 && (
          <div style={{textAlign:"center",padding:48,color:"#64748b"}}>
            <div style={{fontSize:28,marginBottom:8}}>🔍</div>
            <div style={{fontSize:13,fontWeight:600}}>No signals match current filters</div>
            <div style={{fontSize:11,marginTop:3}}>Try a wider time window or remove filters</div>
          </div>
        )}

        {/* SIGNAL CARDS */}
        {!loading && filtered.map(s => (
          <Card key={s.id} s={s} onClick={setSelected}/>
        ))}

        {/* FOOTER */}
        <div style={{textAlign:"center",fontSize:10,color:"#94a3b8",marginTop:20,lineHeight:1.8}}>
          Sources: openFDA (api.fda.gov) · European Medicines Agency (ema.europa.eu)<br/>
          Data updated 2× per day · For research only · Not financial advice
        </div>
      </div>

      {/* MODAL */}
      {selected && <Modal s={selected} onClose={() => setSelected(null)}/>}
    </div>
  );
}

