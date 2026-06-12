const API_URL = "https://estatuto-organico-uasd-con-chatbot.onrender.com";

let esperandoRespuesta = false;

let esperandoRespuesta = false;

// Verificar que el servidor está disponible
async function verificarServidor() {
  try {
    const response = await fetch("/health");
    if (!response.ok) {
      console.warn("Servidor no disponible:", response.status);
      appendMessage("ai", "⚠️ El servidor no está disponible. Recarga la página.");
    } else {
      const data = await response.json();
      console.log("Servidor OK - Provider:", data.provider, "- Documento:", data.documentLoaded ? "✓" : "✗");
    }
  } catch (error) {
    console.error("Error verificando servidor:", error);
    appendMessage("ai", "⚠️ No se puede conectar con el servidor. Verifica tu conexión.");
  }
}

async function preguntar() {
  if (esperandoRespuesta) return;

  const input = document.getElementById("pregunta");
  const botonEnviar = document.getElementById("enviar");
  const pregunta = input.value.trim();
  
  if (!pregunta) return;

  appendMessage("user", pregunta);
  input.value = "";
  esperandoRespuesta = true;
  input.disabled = true;
  botonEnviar.disabled = true;

  // Crear mensaje de carga con animación
  const { wrapper, contentDiv } = appendMessage("ai", "Analizando el estatuto...");
  
  try {
    const response = await fetch("/preguntar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta })
    });

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error("Error parseando JSON:", parseError);
      contentDiv.textContent = "❌ Error: La respuesta del servidor no es válida.";
      contentDiv.classList.add("text-red-500");
      return;
    }

    if (!response.ok) {
      const errorMsg = data.respuesta || "Error al consultar la API.";
      contentDiv.textContent = "❌ " + errorMsg;
      contentDiv.classList.add("text-red-500");
      return;
    }

    if (!data.respuesta) {
      console.error("Respuesta vacía del servidor:", data);
      contentDiv.textContent = "❌ El servidor no devolvió una respuesta.";
      contentDiv.classList.add("text-red-500");
      return;
    }

    contentDiv.textContent = data.respuesta;
  } catch (error) {
    console.error("Error en la solicitud:", error);
    contentDiv.textContent = "❌ " + (error.message || "Error al conectar con el servidor.");
    contentDiv.classList.add("text-red-500");
  } finally {
    esperandoRespuesta = false;
    input.disabled = false;
    botonEnviar.disabled = false;
    input.focus();
  }
}

function appendMessage(role, text) {
  const chatContainer = document.getElementById("chat-container");
  
  if (!chatContainer) {
    console.error("chat-container no encontrado");
    return { wrapper: null, contentDiv: null };
  }
  
  const wrapper = document.createElement("div");
  wrapper.className = `flex w-full mb-4 ${role === "user" ? "justify-end" : "justify-start"}`;

  const bubble = document.createElement("div");
  bubble.className =
    role === "user"
      ? "max-w-[85%] md:max-w-[70%] p-4 shadow-sm bg-blue-700 text-white rounded-l-lg rounded-tr-lg"
      : "max-w-[85%] md:max-w-[70%] p-4 shadow-sm bg-white text-gray-800 rounded-r-lg rounded-tl-lg border border-gray-200";

  const label = document.createElement("p");
  label.className = "text-xs font-bold mb-1 opacity-70";
  label.textContent = role === "user" ? "Tú" : "Asistente UASD";

  const contentDiv = document.createElement("div");
  contentDiv.className = "text-sm leading-relaxed text-content whitespace-pre-wrap";
  contentDiv.textContent = text;

  bubble.append(label, contentDiv);
  wrapper.appendChild(bubble);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  return { wrapper, contentDiv };
}

function sugerencia(texto) {
  const input = document.getElementById("pregunta");
  if (input) {
    input.value = texto;
    preguntar();
  }
}

// Inicializar event listeners cuando el DOM esté listo
function inicializarEventos() {
  const chatForm = document.getElementById("chat-form");
  if (chatForm) {
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      preguntar();
    });
  } else {
    console.error("chat-form no encontrado");
  }

  document.querySelectorAll(".suggestion-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const pregunta = button.dataset.pregunta;
      if (pregunta) {
        sugerencia(pregunta);
      }
    });
  });
}

// Inicializar cuando el DOM esté cargado
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    inicializarEventos();
    verificarServidor();
  });
} else {
  // Si el script se carga al final, el DOM ya está listo
  inicializarEventos();
  verificarServidor();
}
