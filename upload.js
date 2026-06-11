import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function main() {
  console.log("Probando lectura de PDF con Gemini...");

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  const pdfData = fs.readFileSync("estatutoUASD.pdf");
  const pdfPart = {
    inlineData: {
      data: pdfData.toString("base64"),
      mimeType: "application/pdf"
    }
  };

  const prompt = "¿De qué trata este documento de forma resumida?";

  const result = await model.generateContent([pdfPart, prompt]);
  const response = await result.response;

  console.log("Respuesta de prueba:");
  console.log(response.text());
}
main();