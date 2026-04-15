import React, { useState, useEffect, useRef } from 'react';

// ==========================================
// 1. KRYPTOGRAFICKÁ & DATABÁZOVÁ VRSTVA
// ==========================================
const DB_NAME = 'LexForensicaVault';
const STORE_NAME = 'encryptedCases';

// HOLE #8 FIX: isLikelyEncrypted guard
function isLikelyEncrypted(data) {
  if (!data) return false;
  if (data.cipher && data.iv && data.salt) return true;
  if (typeof data === 'string') {
    const entropy = new Set(data.split('')).size / data.length;
    if (entropy > 0.9 && data.length > 64) return true;
  }
  return false;
}

class SecureStorage {
  static async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
    );
    return window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
  }

  static async encryptData(data, password) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    const enc = new TextEncoder();
    const cipher = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(data))
    );
    return { cipher, iv, salt };
  }

  static async decryptData(encryptedObj, password) {
    try {
      const key = await this.deriveKey(password, encryptedObj.salt);
      const plainBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: encryptedObj.iv }, key, encryptedObj.cipher
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(plainBuffer));
    } catch (e) {
      throw new Error('Neplatné dešifrovací heslo.');
    }
  }
}

// ==========================================
// 2. MOCK AI VÝSTUP (Generováno po uploadu)
// ==========================================
const GENERATED_AI_ANALYSIS = {
  caseId: "CASE-" + Math.floor(Math.random() * 10000),
  metadata: {
    patientCode: "SUBJ-X92",
    jurisdiction: "CZ/EU",
    status: "Active Audit"
  },
  chronology: [
    {
      id: "ev_1",
      date: "2025-05-10T14:30:00",
      type: "admission",
      title: "Přijetí na urgentní příjem",
      description: "Pacient přivezen ZZS v agitovaném stavu. Prvotní diagnóza: Akutní polymorfní psychotická porucha. Indikována hospitalizace na uzavřeném oddělení.",
      source: "01_lekarska_zprava_prijem.pdf",
      confidence: 0.98,
      legalFlags: [],
      biasFlags: ["Anchoring Bias"],
      entities: ["ZZS", "MUDr. Kovář"]
    },
    {
      id: "ev_2",
      date: "2025-05-10T16:15:00",
      type: "intervention",
      title: "Aplikace omezovacích prostředků (Kurty)",
      description: "Pro nespolupráci a verbální agresivitu aplikováno mechanické omezení (4-bodové kurty) a podán haloperidol i.m.",
      source: "02_osetrovatelsky_zaznam.pdf",
      confidence: 0.95,
      legalFlags: ["CZ_372_SEC_39", "CRPD_ART_15"],
      biasFlags: [],
      entities: ["Sestra Nováková", "Haloperidol"]
    },
    {
      id: "ev_3",
      date: "2025-05-11T08:00:00",
      type: "observation",
      title: "Ranní vizita - Zanedbání somatiky",
      description: "Pacient utlumen, stěžuje si na bolest na hrudi. EKG neprovedeno z důvodu 'nedostatečné compliance'. Pokračuje se v medikaci.",
      source: "03_zaznam_vizita.pdf",
      confidence: 0.82,
      legalFlags: ["EU_CHARTER_ART_35"],
      biasFlags: ["Premature Closure", "Semantic Shift"],
      entities: ["MUDr. Kovář"]
    },
    {
      id: "ev_4",
      date: "2025-05-12T11:30:00",
      type: "legal",
      title: "Návrh na omezení svéprávnosti",
      description: "Odeslán návrh soudu. Znalec uvádí: 'Trvalá neschopnost činit právní jednání.'",
      source: "04_znalecky_posudek.pdf",
      confidence: 0.99,
      legalFlags: ["CRPD_ART_12"],
      biasFlags: ["Confirmation Bias"],
      entities: ["Znalec MUDr. Dvořák", "Okresní soud"]
    }
  ],
  legalMatrix: [
    {
      id: "CZ_372_SEC_39",
      law: "Zák. č. 372/2011 Sb. § 39 (Omezovací prostředky)",
      description: "Omezovací prostředky lze použít pouze k odvrácení bezprostředního ohrožení života nebo zdraví.",
      violationRisk: "HIGH",
      evidenceRef: "ev_2",
      rationale: "Z dokumentace vyplývá, že kurty byly použity primárně pro 'nespolupráci', chybí důkaz fyzického ohrožení."
    },
    {
      id: "CRPD_ART_12",
      law: "UN CRPD Článek 12 (Svéprávnost)",
      description: "Rovnost před zákonem a právo na podporované rozhodování.",
      violationRisk: "CRITICAL",
      evidenceRef: "ev_4",
      rationale: "Navrženo plné zbavení způsobilosti (náhradní rozhodování) v přímém rozporu s principem podporovaného rozhodování."
    }
  ],
  humanReviewQueue: [
    {
      id: "q_1",
      relatedEventId: "ev_3",
      question: "AI detekovala iatrogenní riziko: Somatická stížnost (bolest na hrudi) byla ignorována s odkazem na psychiatrický status ('non-compliance'). Lze toto klasifikovat jako 'Diagnostic overshadowing' (Zanedbání péče)?",
      status: "PENDING",
      aiConfidence: 0.75
    }
  ]
};

// ==========================================
// 3. IKONY
// ==========================================
const Icons = {
  Shield: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>,
  Lock: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>,
  Timeline: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>,
  Scale: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>,
  Network: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>,
  Brain: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>,
  UserCheck: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>,
  Alert: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>,
  UploadCloud: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>,
  FileText: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>,
  Loader: () => <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>,
  Trash: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
};

// ==========================================
// 4. HLAVNÍ APLIKACE & STAV
// ==========================================
export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState('upload'); // Default to Upload
  const [caseData, setCaseData] = useState(null); // Null = No data yet

  const handleUnlock = async (e) => {
    e.preventDefault();
    // HOLE #1 FIX: Auth via derived key — no hardcoded password
    try {
      const db = await SecureStorage.initDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const allKeys = await new Promise(resolve => {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve([]);
      });
      if (allKeys.length === 0) {
        setIsUnlocked(true); // First use — password creates vault
      } else {
        const firstEntry = await new Promise(resolve => {
          const req = store.get(allKeys[0]);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
        if (firstEntry) {
          await SecureStorage.decryptData(firstEntry, password);
          setIsUnlocked(true);
        }
      }
    } catch (e) {
      alert('Nesprávné heslo.');
      return;
    }
  };

  const handleAnalysisComplete = async (generatedData) => {
    setCaseData(generatedData);
    // Uložení do lokální DB po analýze
    try {
      const db = await SecureStorage.initDB();
      // HOLE #8 FIX: Guard against double-encryption
      if (isLikelyEncrypted(generatedData)) {
        console.warn('Data already encrypted — skipping re-encrypt');
        return;
      }
      const encrypted = await SecureStorage.encryptData(generatedData, password);
      const writeTx = db.transaction(STORE_NAME, 'readwrite');
      writeTx.objectStore(STORE_NAME).put({
        id: generatedData.caseId,
        cipher: encrypted.cipher,
        iv: encrypted.iv,
        salt: encrypted.salt
      });
      setActiveTab('dashboard'); // Přepnutí na výsledky
    } catch (e) {
      console.error("Chyba ukládání DB", e);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl max-w-md w-full border border-slate-700">
          <div className="flex justify-center mb-6 text-blue-500"><Icons.Shield /></div>
          <h1 className="text-2xl font-bold text-center text-white mb-2">STEELS LEGAL SECURITY</h1>
          <p className="text-slate-400 text-center text-sm mb-8">LEX FORENSICA Kryptografická Brána</p>
          <form onSubmit={handleUnlock} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Hlavní dešifrovací klíč</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" placeholder="Zadejte heslo..." />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg flex justify-center items-center gap-2 transition">
              <Icons.Lock /> Vstoupit do bezpečného prostředí
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="p-4 bg-slate-950 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Icons.Shield /> LEX FORENSICA</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">Forenzní AI Auditor</p>
        </div>
        
        <nav className="flex-1 py-4 space-y-1">
          <NavItem active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={<Icons.UploadCloud />} label="Nahrát Důkazy (Vstup)" />
          
          {/* Tyto záložky jsou viditelné/aktivní až po provedení analýzy */}
          {caseData && (
            <>
              <div className="px-6 text-xs font-bold text-slate-600 mt-6 mb-2 uppercase">Výsledky Analýzy</div>
              <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Icons.Alert />} label="Shrnutí případu" />
              <NavItem active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={<Icons.Timeline />} label="Infografika Chronologie" />
              <NavItem active={activeTab === 'graph'} onClick={() => setActiveTab('graph')} icon={<Icons.Network />} label="Důkazní Graf" />
              <NavItem active={activeTab === 'legal'} onClick={() => setActiveTab('legal')} icon={<Icons.Scale />} label="Právní Pochybení" />
              <NavItem active={activeTab === 'bias'} onClick={() => setActiveTab('bias')} icon={<Icons.Brain />} label="Detekce Zkreslení" />
              <NavItem active={activeTab === 'review'} onClick={() => setActiveTab('review')} icon={<Icons.UserCheck />} label="Lidská Revize" />
            </>
          )}
        </nav>

        <div className="p-4 bg-slate-950 border-t border-slate-800 text-xs text-slate-500">
          <div>Lokální end-to-end šifrování aktivní.</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="font-semibold text-slate-700">
            {caseData ? `Zpracovaný případ: ${caseData.caseId}` : 'Čekání na vstupní data...'}
          </div>
          {caseData && (
            <button onClick={() => window.print()} className="text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium border border-slate-300 transition-colors">
              Exportovat Auditní Zprávu
            </button>
          )}
        </header>

        <div className="flex-1 overflow-auto p-6 bg-slate-50/50">
          {activeTab === 'upload' && <UploadView onComplete={handleAnalysisComplete} />}
          {activeTab === 'dashboard' && caseData && <DashboardView caseData={caseData} />}
          {activeTab === 'timeline' && caseData && <TimelineView events={caseData.chronology} />}
          {activeTab === 'graph' && caseData && <GraphView caseData={caseData} />}
          {activeTab === 'legal' && caseData && <LegalView matrix={caseData.legalMatrix} events={caseData.chronology} />}
          {activeTab === 'bias' && caseData && <BiasView events={caseData.chronology} />}
          {activeTab === 'review' && caseData && <ReviewView queue={caseData.humanReviewQueue} onResolve={(id) => {
            setCaseData(prev => ({ ...prev, humanReviewQueue: prev.humanReviewQueue.map(q => q.id === id ? {...q, status: 'RESOLVED'} : q) }));
          }} />}
        </div>
      </main>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
      active ? 'bg-blue-600/10 text-blue-400 border-r-4 border-blue-500' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-r-4 border-transparent'
    }`}>
      {icon} {label}
    </button>
  );
}

// ------------------------------------------
// 1. UPLOAD VIEW (NOVÉ - Interaktivní Vstup)
// ------------------------------------------
function UploadView({ onComplete }) {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files).map(f => ({
      name: f.name, size: (f.size / 1024).toFixed(1) + ' KB', type: f.type
    }));
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const addLog = (msg) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const startAnalysis = async () => {
    if (files.length === 0) return alert("Prosím nahrajte alespoň jeden důkazní materiál.");
    
    setIsProcessing(true);
    setLogs([]);
    
    // Simulace analytického pipeline (SUPERPROMPT v5)
    addLog("Zahajuji Data-Agnostic Ingestion (INPUT)...");
    await new Promise(r => setTimeout(r, 1000));
    
    addLog("Spouštím OCR a extrakci textu. Normalizuji data...");
    await new Promise(r => setTimeout(r, 1500));
    
    addLog("Fáze ANALYZE: Aplikuji deduktivní parsování a vektorové vnoření.");
    await new Promise(r => setTimeout(r, 1200));

    addLog("Generuji chronologii a sémantické vazby...");
    await new Promise(r => setTimeout(r, 1500));

    addLog("Fáze EVALUATE: Mapuji události vůči legislativní matici (Zák. 372/2011, CRPD, EU Charter)...");
    await new Promise(r => setTimeout(r, 2000));

    addLog("Analýza dokončena. Rekonstruuji infografický výstup.");
    await new Promise(r => setTimeout(r, 800));
    
    setIsProcessing(false);
    onComplete(GENERATED_AI_ANALYSIS);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Nahrání Důkazních Materiálů</h2>
        <p className="text-slate-500 mb-6">Nahrajte lékařské zprávy, posudky, ošetřovatelskou dokumentaci (PDF, TXT, CSV). Systém z nich extrahuje časovou osu a identifikuje právní pochybení.</p>
        
        {/* Drag & Drop Zone */}
        {!isProcessing && (
          <div 
            onClick={() => fileInputRef.current.click()}
            className="border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer mb-6 text-center"
          >
            <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            <div className="text-blue-500 mb-3"><Icons.UploadCloud /></div>
            <div className="font-semibold text-blue-700 mb-1">Klikněte nebo přetáhněte soubory sem</div>
            <div className="text-sm text-blue-500">Podporováno: PDF, ODT, DOCX, TXT, CSV (zpracováno lokálně)</div>
          </div>
        )}

        {/* Seznam nahraných souborů */}
        {files.length > 0 && !isProcessing && (
          <div className="mb-6">
            <h3 className="text-sm font-bold text-slate-700 mb-3">Fronta ke zpracování ({files.length} souborů)</h3>
            <ul className="space-y-2">
              {files.map((file, i) => (
                <li key={i} className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400"><Icons.FileText /></span>
                    <span className="text-sm font-medium text-slate-700">{file.name}</span>
                    <span className="text-xs text-slate-400">{file.size}</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <Icons.Trash />
                  </button>
                </li>
              ))}
            </ul>
            
            <div className="mt-6 flex justify-end">
              <button onClick={startAnalysis} className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg shadow-md transition-colors flex items-center gap-2">
                <Icons.Brain /> Spustit Forenzní AI Analýzu
              </button>
            </div>
          </div>
        )}

        {/* Simulace zpracování (Terminál) */}
        {isProcessing && (
          <div className="bg-slate-950 rounded-xl p-6 overflow-hidden border border-slate-800 shadow-inner">
            <div className="flex items-center gap-3 mb-4 border-b border-slate-800 pb-4">
              <span className="text-blue-500"><Icons.Loader /></span>
              <h3 className="text-blue-400 font-mono font-bold text-sm">LEX FORENSICA ENGINE BĚŽÍ...</h3>
            </div>
            <div className="space-y-2 font-mono text-xs text-green-400 min-h-[150px]">
              {logs.map((log, i) => (
                <div key={i} className="animate-pulse">{log}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ------------------------------------------
// 2. DASHBOARD VIEW
// ------------------------------------------
function DashboardView({ caseData }) {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Shrnutí Forenzního Auditu</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-sm font-medium mb-1">Extrahované Události</div>
          <div className="text-3xl font-bold text-slate-800">{caseData.chronology.length}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-red-200 shadow-sm">
          <div className="text-red-500 text-sm font-medium mb-1">Právní Porušení</div>
          <div className="text-3xl font-bold text-red-600">{caseData.legalMatrix.length}</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-orange-200 shadow-sm">
          <div className="text-orange-500 text-sm font-medium mb-1">Detekce Zkreslení / Bias</div>
          <div className="text-3xl font-bold text-orange-600">
            {caseData.chronology.filter(e => e.biasFlags.length > 0).length}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------
// 3. TIMELINE VIEW (Vyžádaná infografika chronologie)
// ------------------------------------------
function TimelineView({ events }) {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Infografická Důkazní Chronologie</h2>
      <p className="text-slate-500 mb-8">Automaticky zrekonstruovaná časová osa případu na základě nahraných dokumentů.</p>
      
      <div className="relative border-l-2 border-slate-200 ml-4 md:ml-1/2">
        {events.map((event) => (
          <div key={event.id} className="mb-10 ml-8 relative group">
            {/* Timeline Dot */}
            <span className={`absolute -left-[41px] flex items-center justify-center w-8 h-8 rounded-full ring-4 ring-slate-50 bg-white border-2 
              ${event.legalFlags.length > 0 ? 'border-red-500 text-red-500' : 'border-blue-500 text-blue-500'}`}>
              <span className="text-xs font-bold">{event.type.substring(0,1).toUpperCase()}</span>
            </span>
            
            {/* Content Card */}
            <div className={`bg-white p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md
              ${event.legalFlags.length > 0 ? 'border-red-200 bg-red-50/10' : 'border-slate-200'}`}>
              
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                  {new Date(event.date).toLocaleString('cs-CZ')}
                </span>
              </div>
              
              <h3 className="text-lg font-bold text-slate-800 mb-2">{event.title}</h3>
              <p className="text-slate-600 text-sm mb-4 leading-relaxed">{event.description}</p>
              
              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
                {event.legalFlags.map(flag => (
                  <span key={flag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                    <Icons.Scale /> Porušení: {flag}
                  </span>
                ))}
                {event.biasFlags.map(flag => (
                  <span key={flag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                    <Icons.Brain /> Zkreslení: {flag}
                  </span>
                ))}
              </div>
              
              <div className="mt-4 text-xs text-slate-500 flex gap-2 items-center bg-slate-50 p-2 rounded border border-slate-100">
                <Icons.FileText /> Nalezeno v: {event.source} (Jistota: {Math.round(event.confidence * 100)}%)
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------
// 4. GRAPH VIEW (Důkazní Graf)
// ------------------------------------------
function GraphView({ caseData }) {
  const width = 800, height = 500;
  const actors = [...new Set(caseData.chronology.flatMap(e => e.entities))].slice(0,4);
  const events = caseData.chronology.map(e => ({ id: e.id, title: e.title }));
  const laws = caseData.legalMatrix.map(l => l.id);
  
  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col">
      <h2 className="text-2xl font-bold text-slate-800 mb-4">Graf Kauzálních Vazeb</h2>
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full min-h-[400px]">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
            </marker>
          </defs>
          
          {/* Vazby (statické pro demo) */}
          <path d="M 200 100 C 200 150, 400 150, 400 200" fill="none" stroke="#cbd5e1" strokeWidth="2" markerEnd="url(#arrow)" />
          <path d="M 400 250 C 400 300, 400 300, 400 350" fill="none" stroke="#fca5a5" strokeWidth="2" markerEnd="url(#arrow)" />

          {/* Uzly - Aktéři */}
          <g transform={`translate(200, 80)`}>
            <rect x="-60" y="-20" width="120" height="40" rx="20" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="2" />
            <text x="0" y="5" textAnchor="middle" fontSize="12" fill="#334155">{actors[0] || 'Personál'}</text>
          </g>

          {/* Uzly - Události */}
          <g transform={`translate(400, 220)`}>
            <rect x="-80" y="-20" width="160" height="40" rx="6" fill="#eff6ff" stroke="#93c5fd" strokeWidth="2" />
            <text x="0" y="5" textAnchor="middle" fontSize="12" fill="#1e40af">Kritická událost (Restrikce)</text>
          </g>

          {/* Uzly - Právo */}
          <g transform={`translate(400, 380)`}>
            <rect x="-90" y="-20" width="180" height="40" rx="6" fill="#fef2f2" stroke="#f87171" strokeWidth="2" />
            <text x="0" y="5" textAnchor="middle" fontSize="11" fill="#991b1b">{laws[0] || 'Právní rámec'}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

// ------------------------------------------
// 5. LEGAL VIEW (Právní Hodnocení)
// ------------------------------------------
function LegalView({ matrix, events }) {
  return (
    <div className="max-w-5xl mx-auto py-4">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Detekovaná Právní Pochybení</h2>
      <div className="space-y-6">
        {matrix.map(violation => {
          const linkedEvent = events.find(e => e.id === violation.evidenceRef);
          return (
            <div key={violation.id} className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col md:flex-row">
              <div className="bg-red-50/50 p-6 md:w-1/3 border-r border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <Icons.Scale />
                  <h3 className="font-bold text-slate-800">{violation.law}</h3>
                </div>
                <span className="text-xs font-bold px-2 py-1 bg-red-600 text-white rounded">{violation.violationRisk} RISK</span>
                <p className="text-sm text-slate-600 mt-4">{violation.description}</p>
              </div>
              <div className="p-6 md:w-2/3">
                <h4 className="text-xs font-bold text-slate-400 uppercase">Zdůvodnění AI</h4>
                <p className="text-slate-800 text-sm mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">{violation.rationale}</p>
                {linkedEvent && (
                  <div className="text-sm font-semibold text-blue-600">
                    Nalezeno v: {linkedEvent.title} ({linkedEvent.source})
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}

// ------------------------------------------
// 6. BIAS VIEW (Zkreslení) & 7. REVIEW VIEW
// ------------------------------------------
function BiasView({ events }) {
  const eventsWithBias = events.filter(e => e.biasFlags.length > 0);
  return (
    <div className="max-w-5xl mx-auto py-4">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Sémantický Posun a Zkreslení</h2>
      {eventsWithBias.map(event => (
        <div key={event.id} className="bg-white rounded-xl border border-purple-200 shadow-sm p-6 mb-4 border-l-4 border-l-purple-500">
          <div className="font-bold text-slate-800">{event.title}</div>
          <div className="text-sm text-slate-600 mt-2">{event.description}</div>
          <div className="mt-3 flex gap-2">
            {event.biasFlags.map(f => <span key={f} className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">{f}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewView({ queue, onResolve }) {
  return (
    <div className="max-w-4xl mx-auto py-4">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Lidská Revize (Human-In-The-Loop)</h2>
      {queue.map(item => (
        <div key={item.id} className={`p-6 bg-white border rounded-xl shadow-sm ${item.status === 'RESOLVED' ? 'border-green-200 opacity-50' : 'border-blue-200'}`}>
          <div className="font-medium text-lg mb-4">{item.question}</div>
          {item.status !== 'RESOLVED' && (
            <div className="flex gap-3">
              <button onClick={() => onResolve(item.id)} className="px-4 py-2 bg-green-600 text-white rounded text-sm">Potvrdit</button>
              <button onClick={() => onResolve(item.id)} className="px-4 py-2 bg-red-100 text-red-700 rounded text-sm">Zamítnout</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}