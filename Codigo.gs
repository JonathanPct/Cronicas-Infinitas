/**
 * Proxy de Gemini para Crónicas Infinitas (Google Apps Script).
 *
 * La clave se guarda en Configuración del proyecto → Propiedades del script,
 * con el nombre GEMINI_API_KEY. Nunca se escribe en este código ni en GitHub.
 *
 * Propiedades opcionales:
 *   GEMINI_MODEL        Modelos separados por comas, en orden de preferencia
 *                       (por defecto: MODELOS_POR_DEFECTO). Si uno falla se usa el siguiente.
 *   GEMINI_TEMPERATURE  Creatividad de la narración (por defecto: 1.0).
 *   LIMITE_POR_MINUTO   Peticiones máximas por minuto en total (por defecto: 60).
 */

var API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
var MAX_BYTES = 300 * 1024;
var MODELOS_POR_DEFECTO = 'gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash,gemini-2.5-flash-lite';

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_API_KEY');
    if (!key) return responder_({ error: 'El servidor no tiene configurada la clave de Gemini.' });

    if (!e || !e.postData || !e.postData.contents) return responder_({ error: 'Petición vacía.' });
    if (e.postData.contents.length > MAX_BYTES) return responder_({ error: 'Petición demasiado grande.' });
    if (limiteSuperado_(Number(props.getProperty('LIMITE_POR_MINUTO')) || 60)) {
      return responder_({ error: 'Demasiadas peticiones. Se debe esperar un momento.' });
    }

    var payload = JSON.parse(e.postData.contents);
    if (!payload.contents || !payload.contents.length) return responder_({ error: 'Petición no válida.' });

    var generationConfig = {
      temperature: Number(props.getProperty('GEMINI_TEMPERATURE')) || 1.0,
      responseMimeType: 'application/json'
    };
    if (payload.schema) generationConfig.responseSchema = payload.schema;

    var body = JSON.stringify({
      systemInstruction: { parts: [{ text: String(payload.system || '') }] },
      contents: payload.contents,
      generationConfig: generationConfig
    });

    var modelos = (props.getProperty('GEMINI_MODEL') || MODELOS_POR_DEFECTO)
      .split(',').map(function (m) { return m.trim().replace(/^models\//, ''); }).filter(String);

    var ultimoError = 'Sin modelos configurados.';
    var cache = CacheService.getScriptCache();
    for (var i = 0; i < modelos.length; i++) {
      var ultimo = i === modelos.length - 1;
      // Un modelo saturado recientemente se omite durante unos minutos (salvo que sea el último).
      if (!ultimo && cache.get('saturado_' + modelos[i])) continue;
      var r = UrlFetchApp.fetch(API_BASE + '/models/' + encodeURIComponent(modelos[i]) + ':generateContent', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': key },
        payload: body,
        muteHttpExceptions: true
      });
      var status = r.getResponseCode();
      var data = {};
      try { data = JSON.parse(r.getContentText()); } catch (err) { /* Respuesta no JSON */ }

      if (status !== 200) {
        ultimoError = (data.error && data.error.message) || ('Error HTTP ' + status + ' de Gemini');
        // Modelo inexistente, saturado o sin cuota: se marca y se prueba el siguiente de la lista.
        if (status === 404 || status === 429 || status === 500 || status === 503) {
          cache.put('saturado_' + modelos[i], '1', status === 404 ? 21600 : 600);
          continue;
        }
        return responder_({ error: ultimoError });
      }

      var cand = data.candidates && data.candidates[0];
      if (!cand) {
        var motivo = data.promptFeedback && data.promptFeedback.blockReason;
        return responder_({ error: 'El modelo no ha devuelto respuesta' + (motivo ? ' (bloqueada: ' + motivo + ').' : '.') });
      }
      var texto = ((cand.content && cand.content.parts) || [])
        .filter(function (p) { return !p.thought; })
        .map(function (p) { return p.text || ''; })
        .join('');
      return responder_({ text: texto, model: modelos[i], finishReason: cand.finishReason });
    }
    return responder_({ error: ultimoError });
  } catch (err) {
    return responder_({ error: 'Error interno del proxy: ' + err.message });
  }
}

// Permite comprobar desde el navegador que el despliegue está activo.
function doGet() {
  var configurada = !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  return responder_({ ok: true, claveConfigurada: configurada });
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Contador global por minuto para limitar el consumo de la clave.
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
