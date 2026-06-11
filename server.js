import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { PDFParse } from "pdf-parse";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const provider = process.env.AI_PROVIDER || (process.env.OPENROUTER_API_KEY ? "openrouter" : "gemini");
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const openRouterModel = process.env.OPENROUTER_MODEL || "openrouter/free";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
  console.error("ERROR: Falta GEMINI_API_KEY en el archivo .env");
  process.exit(1);
}

if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
  console.error("ERROR: Falta OPENROUTER_API_KEY en el archivo .env");
  process.exit(1);
}

const ai = provider === "gemini" ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

let pdfPart = null;
let pdfBase64 = "";
let pdfText = "";
try {
  const pdfPath = path.join(__dirname, "estatutoUASD.pdf");
  const pdfData = fs.readFileSync(pdfPath);
  pdfBase64 = pdfData.toString("base64");
  const parser = new PDFParse({ data: pdfData });
  const result = await parser.getText();
  pdfText = normalizeText(result.text);
  pdfPart = {
    inlineData: {
      data: pdfBase64,
      mimeType: "application/pdf"
    }
  };
  console.log(`Documento estatutoUASD.pdf cargado correctamente. Texto extraido: ${pdfText.length} caracteres.`);
} catch (error) {
  console.error("No se pudo leer estatutoUASD.pdf:", error.message);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    documentLoaded: Boolean(pdfBase64),
    textLoaded: Boolean(pdfText),
    provider,
    model: provider === "openrouter" ? openRouterModel : geminiModel
  });
});

app.post("/preguntar", async (req, res) => {
  const pregunta = String(req.body?.pregunta || "").trim();

  if (!pregunta) {
    return res.status(400).json({ respuesta: "Escribe una pregunta sobre el Estatuto Organico de la UASD." });
  }

  if (!pdfBase64 && !pdfText) {
    return res.status(500).json({ respuesta: "El PDF del estatuto no esta cargado en el servidor." });
  }

  try {
    const respuesta = provider === "openrouter"
      ? await responderConOpenRouter(pregunta)
      : await responderConGemini(pregunta);

    if (!respuesta) {
      console.warn("Respuesta vacía o undefined:", { provider, pregunta: pregunta.substring(0, 50) });
      return res.json({
        respuesta: "La IA no pudo generar una respuesta para esta pregunta."
      });
    }

    res.json({
      respuesta: respuesta
    });
  } catch (error) {
    console.error("Error consultando IA:", error);
    const message = error?.message || "";
    const depletedCredits =
      error?.status === 429 &&
      (message.includes("prepayment credits are depleted") || message.includes("RESOURCE_EXHAUSTED"));

    res.status(500).json({
      respuesta: depletedCredits
        ? "La API de Gemini respondio que los creditos de esta clave estan agotados. Genera una clave gratuita nueva en Google AI Studio o revisa la facturacion del proyecto."
        : "Hubo un problema consultando la API de IA. Revisa la clave, el modelo o tu conexion."
    });
  }
});

async function responderConGemini(pregunta) {
  console.log("Pregunta recibida en Gemini:", pregunta.substring(0, 50) + "...");;
  
  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: [
      {
        text:
          "Pregunta del usuario: " +
          pregunta +
          "\n\nResponde en espanol, de forma clara y breve. Usa solo el PDF adjunto. " +
          "Si la respuesta no aparece en el documento, dilo explicitamente."
      },
      pdfPart
    ],
    config: {
      systemInstruction:
        "Eres un asistente academico de la UASD. Tu unica fuente es el Estatuto Organico de la UASD adjunto. " +
        "No inventes datos y no respondas preguntas que no esten relacionadas con ese documento."
    }
  });

  const respuesta = response.text?.trim();
  console.log("Respuesta de Gemini generada, longitud:", respuesta?.length);
  return respuesta;
}

async function responderConOpenRouter(pregunta) {
  const contexto = getRelevantContext(pregunta);
  const tieneContexto = contexto.length > 1000 && pdfText.length > 10000;

  console.log("Pregunta recibida:", pregunta.substring(0, 50) + "...");
  console.log("Usando contexto del PDF:", tieneContexto);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-OpenRouter-Title": "ChatBot UASD"
    },
    body: JSON.stringify({
      model: openRouterModel,
      messages: [
        {
          role: "system",
          content: tieneContexto
            ? "Eres un asistente academico de la UASD. Tu unica fuente son los fragmentos del Estatuto Organico de la UASD que recibe el usuario. Responde en espanol, de forma clara y breve. No inventes datos. Si no hay base suficiente en los fragmentos, dilo."
            : "Eres un asistente academico para un proyecto escolar sobre el Estatuto Organico de la UASD. Responde en espanol, de forma clara y breve, enfocandote solo en preguntas relacionadas con la UASD, sus estatutos, autoridades, organos de gobierno, autonomia, mision, fines y estructura universitaria. Si la pregunta no es de ese tema, dilo."
        },
        {
          role: "user",
          content: tieneContexto
            ? "Fragmentos relevantes del Estatuto Organico de la UASD:\n\n" +
              contexto +
              "\n\nPregunta del usuario: " +
              pregunta +
              "\n\nResponde usando solo los fragmentos anteriores."
            : "Pregunta del usuario sobre el Estatuto Organico de la UASD: " + pregunta
        }
      ]
    })
  });

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error("Error parseando respuesta de OpenRouter:", parseError);
    throw new Error("OpenRouter devolvió una respuesta inválida.");
  }

  if (!response.ok) {
    console.error("OpenRouter error (status " + response.status + "):", data);
    throw new Error(data?.error?.message || "OpenRouter no pudo procesar la solicitud.");
  }

  const respuesta = data?.choices?.[0]?.message?.content?.trim();
  
  if (!respuesta) {
    console.error("Respuesta vacía de OpenRouter:", data);
    throw new Error("OpenRouter devolvió una respuesta vacía.");
  }

  console.log("Respuesta generada correctamente, longitud:", respuesta.length);
  return respuesta;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/-\n/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getRelevantContext(question) {
  if (!pdfText) return "";

  const normalizedQuestion = normalizeForSearch(question);
  const terms = normalizedQuestion
    .split(/\s+/)
    .filter((term) => term.length > 3 && !["cual", "como", "donde", "quien", "para"].includes(term));
  const mainPhrase = extractMainPhrase(normalizedQuestion);
  const chunks = buildTextWindows(pdfText, 2600, 700);

  const ranked = chunks
    .map((chunk) => {
      const normalizedChunk = normalizeForSearch(chunk);
      const score = terms.reduce((total, term) => {
        const matches = normalizedChunk.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, "g"));
        return total + (matches ? matches.length : 0);
      }, 0);
      const phraseScore = mainPhrase && normalizedChunk.includes(mainPhrase) ? 10 : 0;
      const definitionScore =
        normalizedChunk.includes(" es la ") ||
        normalizedChunk.includes(" es el ") ||
        normalizedChunk.includes(" son ") ||
        normalizedChunk.includes(" esta integrado")
          ? 4
          : 0;
      const articleScore = normalizedChunk.includes("articulo") ? 2 : 0;

      return {
        chunk: chunk.text,
        index: chunk.index,
        score: score + phraseScore + definitionScore + articleScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.chunk);

  const selected = ranked.length ? ranked : chunks.slice(0, 5).map((chunk) => chunk.text);
  return selected.join("\n\n---\n\n").slice(0, 14000);
}

function buildTextWindows(text, size, overlap) {
  const windows = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    windows.push({
      index: start,
      text: text.slice(start, start + size)
    });
  }
  return windows;
}

function extractMainPhrase(normalizedQuestion) {
  const withoutQuestionWords = normalizedQuestion
    .replace(/\b(que|quien|quienes|cual|cuales|como|donde|cuando|define|explica|sobre)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = withoutQuestionWords.split(/\s+/).filter((word) => word.length > 3);
  return words.slice(0, 4).join(" ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForSearch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ");
}

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
