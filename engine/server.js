// server.js
// API Backend pro LEX FORENSICA
// HOLE #11 FIX: helmet + rate-limit + CORS origin restriction
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const prisma = new PrismaClient();

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// HOLE #10 FIX: Rate limiting
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Příliš mnoho požadavků.' }
});

// Inicializace Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- REST API ENDPOINTY ---

// Získání všech důkazů pro konkrétní případ
app.get('/api/cases/:caseId/evidence', async (req, res) => {
    try {
        const evidence = await prisma.evidenceEntry.findMany({
            where: { caseId: req.params.caseId },
            orderBy: { timestamp: 'asc' }
        });
        res.json(evidence);
    } catch (error) {
        res.status(500).json({ error: "Chyba při načítání důkazů ze serveru." });
    }
});

// Zajištěný AI Endpoint (Schovává API klíč a obsahuje systémový prompt)
app.post('/api/ai/audit', aiLimiter, async (req, res) => {
    const { text, actionType, lang, caseId } = req.body;
    
    if (!text) return res.status(400).json({ error: "Chybí text k analýze." });
    // HOLE #10 FIX: Input sanitization — limit length, strip control chars
    const MAX_TEXT = 50000;
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Text překračuje limit ${MAX_TEXT} znaků.` });
    const sanitizedText = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    // BREAK FIX: Whitelist actionType
    const VALID_ACTIONS = ['causal_gap', 'semantic_bias', 'universal'];
    const safeAction = VALID_ACTIONS.includes(actionType) ? actionType : 'universal';

    // RAG Simulace: Načtení kontextu spisu (Cross-Reference Engine)
    // V plné produkci bychom zde použili vektorovou databázi. Nyní načteme metadata spisu.
    let caseContext = "";
    if (caseId) {
        const currentCase = await prisma.case.findUnique({ where: { id: caseId } });
        if (currentCase) caseContext = `Kontext spisu: ${(currentCase.title || "").replace(/[\n\r`${}]/g, "")} - ${(currentCase.domain || "").replace(/[\n\r`${}]/g, "")}. `;
    }

    const systemPrompt = `
ROLE: LEX FORENSICA AI Auditor. Jsi univerzální, nestranný forenzní analytik procesního a materiálního práva.
SCHOPNOSTI:
- Sémantický Most: Identifikace fonetických, translačních a významových posunů, které mění právní kvalifikaci.
- Kauzální Chronometr: Detekce mezer v časové ose (evidence gaps).
- Detekce Biasu: Identifikace confirmation biasu, kruhové argumentace a procesních pochybení.
- Právní Rámec: Hodnocení z hlediska lidských práv (EÚLP, CRPD), procesních standardů a presumpce neviny.

PRAVIDLA:
1. Operuj nad jakýmkoliv právním textem (zdravotní, sociální, trestní, pracovní).
2. Tvrzení vždy abstrahuj na úroveň logiky a práva.
3. Používej profesionální Markdown strukturu.
`;

    let userPrompt = "";
    if (actionType === 'causal_gap') {
        userPrompt = `[KAUZÁLNÍ A PROCESNÍ ANALÝZA]\n${caseContext}Analyzuj text na procesní pochybení, důkazní mezery (chybějící revize/testy) a logické fauly. Identifikuj, kde došlo k přerušení kauzálního řetězce.\n\nTEXT:\n"${sanitizedText}"`;
    } else if (actionType === 'semantic_bias') {
        userPrompt = `[SÉMANTICKÝ MOST & BIAS]\n${caseContext}Analyzuj text na přítomnost systémového biasu, nesprávné interpretace pojmů, zaměňování příčiny a následku nebo kontaminaci zdroje (např. převzetí chybné premisy předchozího znalce).\n\nTEXT:\n"${sanitizedText}"`;
    } else {
        userPrompt = `[UNIVERZÁLNÍ FORENZNÍ ZHODNOCENÍ]\n${caseContext}Vytvoř formální zprávu. Definuj (1) Zjištěný stav, (2) Identifikované anomálie / rozpory se standardem, (3) Ztrátu důkazní hodnoty, (4) Doporučené forenzní kroky k nápravě.\n\nTEXT:\n"${sanitizedText}"`;
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        });
        
        const responseText = result.response.text();
        
        // Zápis do Audit logu (anonymizovaný)
        await prisma.auditLog.create({
            data: {
                // HOLE #6 FIX: userId from header or anonymized IP hash
                userId: req.headers['x-user-id'] || `anon_${require('crypto').createHash('sha256').update(req.ip || 'unknown').digest('hex').slice(0,12)}`,
                action: `AI_ANALYSIS_${safeAction.toUpperCase()}`,
                details: `Analyzováno ${text.length} znaků.`
            }
        });

        res.json({ result: responseText });
    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: "Selhání AI modelu." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LEX FORENSICA API běží na portu ${PORT}`));