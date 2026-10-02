/**
 * Proxy del narrador para Crónicas Infinitas (Google Apps Script).
 *
 * Reparte las peticiones entre varios proveedores de IA. Si uno no responde, ha agotado su
 * cuota o devuelve una respuesta no válida, se pasa automáticamente al siguiente.
 *
 * Las claves se guardan en Configuración del proyecto → Propiedades del script y nunca se
 * escriben en este código ni en GitHub. Solo se usan los proveedores con clave configurada:
 *   GEMINI_API_KEY      Google AI Studio
 *   GROQ_API_KEY        console.groq.com
 *   OPENROUTER_API_KEY  openrouter.ai
 *   DEEPSEEK_API_KEY    platform.deepseek.com (de pago)
 *   MISTRAL_API_KEY     console.mistral.ai
 *
 * Propiedades opcionales:
 *   PROVEEDORES         Orden de uso, separado por comas (por defecto: ORDEN_POR_DEFECTO).
 *   GEMINI_MODELOS, GROQ_MODELOS, OPENROUTER_MODELOS, DEEPSEEK_MODELOS, MISTRAL_MODELOS
 *                       Modelos de cada proveedor, separados por comas, en orden de preferencia.
 *   TEMPERATURA         Creatividad de la narración (por defecto: 1.0).
 *   LIMITE_POR_MINUTO   Peticiones máximas por minuto en total (por defecto: 60).
 *
 * Para reducir el consumo, el razonamiento interno de los modelos se desactiva o se reduce al
 * mínimo y la respuesta se limita a MAX_TOKENS_SALIDA.
 */

var MAX_BYTES = 300 * 1024;
var MAX_TOKENS_SALIDA = 4096;
var PRESUPUESTO_MS = 100000;   // Tiempo máximo probando proveedores antes de rendirse
var ORDEN_POR_DEFECTO = 'gemini,groq,openrouter,deepseek,mistral';

var PROVEEDORES = {
  gemini: { clave: 'GEMINI_API_KEY', modelos: 'gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash,gemini-2.5-flash-lite' },
  groq: { clave: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions', modelos: 'openai/gpt-oss-120b,qwen/qwen3.8-27b', formato: 'json_schema' },
  openrouter: { clave: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions', modelos: 'openrouter/free', formato: 'json_schema' },
  deepseek: { clave: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/chat/completions', modelos: 'deepseek-flash', formato: 'json_object' },
  mistral: { clave: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions', modelos: 'mistral-small-latest', formato: 'json_schema' }
};

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();  // Una sola lectura
    if (!e || !e.postData || !e.postData.contents) return responder_({ error: 'Petición vacía.' });
    if (e.postData.contents.length > MAX_BYTES) return responder_({ error: 'Petición demasiado grande.' });
    if (limiteSuperado_(Number(props.LIMITE_POR_MINUTO) || 60)) {
      return responder_({ error: 'Demasiadas peticiones. Se debe esperar un momento.' });
    }
    var payload = JSON.parse(e.postData.contents);
    if (!payload.contents || !payload.contents.length) return responder_({ error: 'Petición no válida.' });
    payload.temperatura = Number(props.TEMPERATURA || props.GEMINI_TEMPERATURE) || 1.0;

    var candidatos = candidatos_(props, payload.preferir, payload.solo);
    if (!candidatos.length) return responder_({ error: 'El servidor no tiene configurado ningún proveedor de IA.' });

    var cache = CacheService.getScriptCache();
    var disponibles = candidatos.filter(function (c) {
      return !cache.get('descartado_' + c.proveedor) && !cache.get('descartado_' + c.proveedor + '|' + c.modelo);
    });
    // Si todos están descartados se prueba igualmente el último, mejor que no responder.
    if (!disponibles.length) disponibles = [candidatos[candidatos.length - 1]];

    var inicio = Date.now(), ultimoError = '';
    for (var i = 0; i < disponibles.length && Date.now() - inicio < PRESUPUESTO_MS; i++) {
      var c = disponibles[i];
      if (cache.get('descartado_' + c.proveedor)) continue;   // Clave rechazada en este mismo intento
      var r = c.proveedor === 'gemini' ? llamarGemini_(c, payload) : llamarCompatible_(c, payload);
      if (!r.ok) {
        ultimoError = c.proveedor + ' (' + c.modelo + '): ' + r.error;
        var t = tiempoDescarte_(r.status, r.error);
        if (r.status === 401 || r.status === 403) cache.put('descartado_' + c.proveedor, '1', t);
        else if (t) cache.put('descartado_' + c.proveedor + '|' + c.modelo, '1', t);
        continue;
      }
      var obj = validar_(r.texto, payload.schema);
      if (!obj) {
        ultimoError = c.proveedor + ' (' + c.modelo + '): respuesta sin el formato esperado';
        cache.put('descartado_' + c.proveedor + '|' + c.modelo, '1', 60);
        continue;
      }
      return responder_({ text: JSON.stringify(obj), proveedor: c.proveedor, model: c.modelo });
    }
    return responder_({ error: ultimoError || 'Ningún proveedor ha respondido.' });
  } catch (err) {
    return responder_({ error: 'Error interno del proxy: ' + err.message });
  }
}

// Comprueba desde el navegador que el despliegue está activo y qué proveedores tienen clave.
function doGet() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var estado = {};
  Object.keys(PROVEEDORES).forEach(function (p) { estado[p] = !!props[PROVEEDORES[p].clave]; });
  return responder_({ ok: true, proveedores: estado, orden: (props.PROVEEDORES || ORDEN_POR_DEFECTO) });
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Lista ordenada de proveedor + modelo. El proveedor preferido (el último que funcionó en esa
// partida) va primero, para que la voz del narrador no cambie sin necesidad.
function candidatos_(props, preferir, solo) {
  var orden = String(props.PROVEEDORES || ORDEN_POR_DEFECTO).split(',')
    .map(function (p) { return p.trim().toLowerCase(); })
    .filter(function (p) { return PROVEEDORES[p] && props[PROVEEDORES[p].clave]; });
  if (solo) orden = orden.filter(function (p) { return p === solo; });
  if (preferir && orden.indexOf(preferir) > 0) orden = [preferir].concat(orden.filter(function (p) { return p !== preferir; }));
  var lista = [];
  orden.forEach(function (p) {
    var cfg = PROVEEDORES[p];
    var modelos = props[p.toUpperCase() + '_MODELOS'] || (p === 'gemini' && props.GEMINI_MODEL) || cfg.modelos;
    String(modelos).split(',').map(function (m) { return m.trim().replace(/^models\//, ''); }).filter(String).forEach(function (m) {
      lista.push({ proveedor: p, modelo: m, clave: props[cfg.clave], cfg: cfg });
    });
  });
  return lista;
}

function peticion_(url, cabeceras, cuerpo) {
  var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: cabeceras, payload: JSON.stringify(cuerpo), muteHttpExceptions: true });
  var data = {};
  try { data = JSON.parse(r.getContentText()); } catch (err) { /* Respuesta no JSON */ }
  return { status: r.getResponseCode(), data: data };
}

function mensajeError_(r) {
  var e = r.data && r.data.error;
  return (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || r.data.message || ('HTTP ' + r.status);
}

// Gemini: formato propio de la API de Google
function llamarGemini_(c, payload) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(c.modelo) + ':generateContent';
  var config = { temperature: payload.temperatura, maxOutputTokens: MAX_TOKENS_SALIDA, responseMimeType: 'application/json' };
  if (payload.schema) config.responseSchema = payload.schema;
  // Si el modelo no admite una configuración de razonamiento, se prueba la siguiente.
  var opciones = /2\.5/.test(c.modelo) ? [{ thinkingBudget: 0 }, null] : [{ thinkingLevel: 'minimal' }, { thinkingBudget: 0 }, null];
  var r;
  for (var j = 0; j < opciones.length; j++) {
    var cfg = JSON.parse(JSON.stringify(config));
    if (opciones[j]) cfg.thinkingConfig = opciones[j];
    r = peticion_(url, { 'x-goog-api-key': c.clave }, {
      systemInstruction: { parts: [{ text: String(payload.system || '') }] },
      contents: payload.contents,
      generationConfig: cfg
    });
    if (!(r.status === 400 && /think/i.test(mensajeError_(r)))) break;
  }
  if (r.status !== 200) return { ok: false, status: r.status, error: mensajeError_(r) };
  var cand = r.data.candidates && r.data.candidates[0];
  if (!cand) {
    var motivo = r.data.promptFeedback && r.data.promptFeedback.blockReason;
    return { ok: false, status: 0, error: 'sin respuesta' + (motivo ? ' (bloqueada: ' + motivo + ')' : '') };
  }
  var texto = ((cand.content && cand.content.parts) || []).filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('');
  return { ok: true, texto: texto };
}

// Groq, OpenRouter, DeepSeek y Mistral: formato compatible con OpenAI
function llamarCompatible_(c, payload) {
  var esquema = payload.schema ? esquemaJSON_(payload.schema) : null;
  var sistema = String(payload.system || '');
  if (esquema) sistema += '\n\nFORMATO DE RESPUESTA: responde únicamente con un objeto JSON válido, sin texto alrededor ni bloques de código, que siga este esquema JSON:\n' + JSON.stringify(esquema);
  var mensajes = [{ role: 'system', content: sistema }].concat(payload.contents.map(function (m) {
    return { role: m.role === 'model' ? 'assistant' : 'user', content: (m.parts || []).map(function (p) { return p.text || ''; }).join('\n') };
  }));
  var cabeceras = { Authorization: 'Bearer ' + c.clave };
  if (c.proveedor === 'openrouter') cabeceras['X-Title'] = 'Cronicas Infinitas';

  // De la configuración más completa a la más simple, por si el modelo no admite alguna opción.
  var intentos = [];
  var base = { model: c.modelo, messages: mensajes, temperature: payload.temperatura, max_tokens: MAX_TOKENS_SALIDA };
  var completo = JSON.parse(JSON.stringify(base));
  if (esquema && c.cfg.formato === 'json_schema') completo.response_format = { type: 'json_schema', json_schema: { name: 'respuesta', schema: esquema, strict: false } };
  else if (esquema) completo.response_format = { type: 'json_object' };
  if (/gpt-oss/.test(c.modelo)) completo.reasoning_effort = 'low';
  intentos.push(completo);
  if (esquema) intentos.push(Object.assign(JSON.parse(JSON.stringify(base)), { response_format: { type: 'json_object' } }));
  intentos.push(base);

  var r;
  for (var j = 0; j < intentos.length; j++) {
    r = peticion_(c.cfg.url, cabeceras, intentos[j]);
    if (r.status !== 400 && r.status !== 422) break;
  }
  if (r.status !== 200) return { ok: false, status: r.status, error: mensajeError_(r) };
  var eleccion = r.data.choices && r.data.choices[0];
  var texto = eleccion && eleccion.message && eleccion.message.content;
  if (Array.isArray(texto)) texto = texto.map(function (p) { return p.text || ''; }).join('');
  if (!texto) return { ok: false, status: 0, error: 'sin respuesta' + (eleccion && eleccion.finish_reason ? ' (' + eleccion.finish_reason + ')' : '') };
  return { ok: true, texto: texto };
}

// Convierte el esquema de Gemini (tipos en mayúsculas) al estándar JSON Schema.
function esquemaJSON_(s) {
  if (!s || typeof s !== 'object') return s;
  var out = {};
  Object.keys(s).forEach(function (k) {
    var v = s[k];
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'properties') { out.properties = {}; Object.keys(v).forEach(function (p) { out.properties[p] = esquemaJSON_(v[p]); }); }
    else if (k === 'items') out.items = esquemaJSON_(v);
    else out[k] = v;
  });
  return out;
}

// Extrae el JSON de la respuesta y comprueba que tiene los campos obligatorios.
function validar_(texto, esquema) {
  var obj = null;
  try { obj = JSON.parse(texto); } catch (err) {
    var limpio = String(texto || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = limpio.indexOf('{'), b = limpio.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(limpio.slice(a, b + 1)); } catch (err2) { obj = null; } }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var requeridos = (esquema && esquema.required) || [];
  for (var i = 0; i < requeridos.length; i++) if (!(requeridos[i] in obj)) return null;
  return obj;
}

// Segundos que se omite un proveedor o modelo que ha fallado. Con la cuota diaria agotada no
// tiene sentido volver a probarlo pronto: cada intento fallido añade segundos de espera.
function tiempoDescarte_(status, mensaje) {
  if (status === 401 || status === 403) return 3600;
  if (status === 402) return 10800;
  if (status === 404) return 21600;
  if (status === 429) return /day|daily|día|per.?day/i.test(mensaje) ? 10800 : 300;
  if (status >= 500 || status === 0) return 180;
  return 0;
}

// Contador global por minuto para limitar el consumo.
function limiteSuperado_(limite) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var clave = 'rpm_' + Math.floor(Date.now() / 60000);
    var usados = Number(cache.get(clave)) || 0;
    if (usados >= limite) return true;
    cache.put(clave, String(usados + 1), 120);
    return false;
  } finally {
    lock.releaseLock();
  }
}
