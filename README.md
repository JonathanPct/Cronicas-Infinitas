# Crónicas Infinitas

RPG de fantasía inspirado en Dungeons & Dragons en el que una IA actúa como Dungeon Master. Cada personaje recibe una campaña propia (mundo, antagonista, secreto y trama en cuatro actos) que evoluciona según sus decisiones.

## Estructura

```
├── index.html            # Juego completo; se publica en GitHub Pages
├── Codigo.gs             # Proxy del narrador; se pega en Google Apps Script (GitHub Pages no lo ejecuta)
├── database.rules.json   # Reglas de seguridad de las salas; se pegan en Firebase
└── README.md
```

## Proveedores de IA y claves

El narrador puede usar varios proveedores. El proxy los prueba en orden y, si uno no responde, ha agotado su cuota o devuelve una respuesta sin el formato esperado, pasa al siguiente sin que el jugador lo note. Cada partida recuerda el último proveedor que funcionó y lo pide primero, para que la voz del narrador no cambie sin necesidad.

| Proveedor | Propiedad del script | Dónde se obtiene la clave | Modelos por defecto |
|---|---|---|---|
| Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/apikey | `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` |
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys | `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys | `openrouter/free` (modelos gratuitos) |
| DeepSeek (de pago) | `DEEPSEEK_API_KEY` | https://platform.deepseek.com/api_keys | `deepseek-flash` |
| Mistral | `MISTRAL_API_KEY` | https://console.mistral.ai/api-keys | `mistral-small-latest` |

Solo se usan los proveedores que tienen clave. Las claves **no se guardan en ningún archivo del repositorio**: están en las Propiedades del script de Google Apps Script, que son privadas. El juego llama al proxy y este añade la clave antes de reenviar la petición. Si una clave aparece en un repositorio público, el proveedor puede revocarla; con este diseño el repositorio puede ser público sin riesgo.

En OpenRouter, los modelos gratuitos requieren permitir en **Settings → Privacy** los proveedores gratuitos. Sin crédito admiten 50 peticiones al día; tras una compra única de 10 $ pasan a 1.000.

## Configuración del proxy (una sola vez)

1. Abrir https://script.google.com y crear un **Proyecto nuevo**.
2. Sustituir el contenido de `Código.gs` por el de `Codigo.gs` y guardar.
3. En **Configuración del proyecto** (icono de engranaje) → **Propiedades del script** → **Añadir propiedad del script**, una por cada proveedor con su clave (tabla anterior).
4. **Implementar** → **Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Autorizar los permisos solicitados y copiar la **URL de la aplicación web** (termina en `/exec`).
6. Pegar esa URL en `index.html`, en la línea:

   ```js
   const PROXY_URL = 'https://script.google.com/macros/s/.../exec';
   ```

7. Comprobación: al abrir la URL `/exec` en el navegador aparece qué proveedores tienen clave, por ejemplo `{"ok":true,"proveedores":{"gemini":true,"groq":true,"openrouter":true,"deepseek":false,"mistral":false},...}`.

### Propiedades opcionales

| Propiedad | Descripción | Valor por defecto |
|---|---|---|
| `PROVEEDORES` | Orden de uso, separado por comas | `gemini,groq,openrouter,deepseek,mistral` |
| `GEMINI_MODELOS`, `GROQ_MODELOS`, `OPENROUTER_MODELOS`, `DEEPSEEK_MODELOS`, `MISTRAL_MODELOS` | Modelos de cada proveedor, separados por comas, en orden de preferencia | Los de la tabla anterior |
| `TEMPERATURA` | Creatividad de la narración | `1.0` |
| `LIMITE_POR_MINUTO` | Peticiones máximas por minuto en total | `60` |

Un modelo que falla se omite durante un tiempo: 3 horas si ha agotado la cuota diaria, 5 minutos si ha superado el límite por minuto, 3 minutos si está saturado y 6 horas si no existe. Un proveedor con la clave rechazada se omite 1 hora.

Los cambios en las propiedades se aplican al momento. Los cambios en el código del script requieren **Implementar → Gestionar implementaciones → Editar → Nueva versión**, manteniendo así la misma URL.

## Modo de prueba

Añadiendo `?prueba` a la dirección del juego (por ejemplo `https://usuario.github.io/repositorio/?prueba`), el narrador responde con textos de ejemplo sin consultar ninguna IA. Sirve para revisar la interfaz, los dados, el mapa o las salas sin gastar cuota. Una etiqueta en la esquina indica que el modo está activo.

## Configuración de las salas multijugador (una sola vez)

Las salas usan Firebase Realtime Database con acceso anónimo: los jugadores no se registran. El plan gratuito (Spark) es suficiente.

1. Abrir https://console.firebase.google.com y **crear un proyecto** (Google Analytics no es necesario).
2. **Compilación → Authentication → Comenzar → Método de acceso → Anónimo → Habilitar**.
3. **Compilación → Realtime Database → Crear base de datos**, ubicación `europe-west1` y modo bloqueado.
4. En la pestaña **Reglas** de la base de datos, sustituir el contenido por el de `database.rules.json` y **Publicar**.
5. **Configuración del proyecto** (engranaje) → **Tus apps** → icono web `</>` → registrar la app (sin Hosting) y copiar el objeto `firebaseConfig`.
6. Pegar esos valores en `index.html`, en la línea:

   ```js
   const FIREBASE_CONFIG = { apiKey: '…', authDomain: '…', databaseURL: '…', projectId: '…', appId: '…' };
   ```

Los valores de `firebaseConfig` identifican el proyecto y son públicos por diseño: no son una clave secreta y pueden estar en el repositorio. Lo que protege los datos son las reglas de `database.rules.json`: solo los miembros de una sala pueden modificarla, cada jugador solo puede crear su propio personaje y las acciones solo se aceptan mientras la ronda está abierta.

Mientras `FIREBASE_CONFIG` valga `null`, el modo en grupo muestra que no está disponible y el modo en solitario funciona con normalidad.

## Consumo de la API

Cada turno es una petición al narrador. Para que las cuotas duren más:

- El razonamiento interno de los modelos se desactiva o se reduce al mínimo y la respuesta se limita a 4096 tokens.
- El narrador recibe las 8 últimas entradas del historial y 30 notas de la crónica (las dos primeras y las más recientes); lo anterior queda resumido en la crónica.
- Las reglas del narrador están condensadas y la biblia de campaña se envía compacta y al principio, para que el modelo pueda reutilizar esa parte entre turnos.

En las cuotas gratuitas, cada modelo tiene su propio límite. El consumo se consulta en el panel de cada proveedor.

## Rendimiento

- Las animaciones (brasas del fondo, escena del lugar) se dibujan a 24-30 fotogramas por segundo, se detienen con la pestaña oculta y la escena se pausa cuando no está en pantalla. Los brillos usan imágenes pregeneradas en lugar de degradados calculados en cada fotograma.
- El círculo rúnico del fondo gira como capa independiente, sin repintar la página.
- El relieve del mapa se calcula a media resolución y en un momento libre, antes de abrir el mapa.
- Los brillos animados de los retratos solo se usan en los retratos grandes.

## Publicación en GitHub Pages

Subir los archivos a la raíz del repositorio y activar Pages en **Settings → Pages** (rama `main`, carpeta raíz). `Codigo.gs` se incluye como referencia: no contiene la clave ni ningún otro dato sensible.

## Funcionamiento

- **Creación de campaña:** a partir del personaje, su trasfondo y unas semillas aleatorias (tema, giro y ambientación), el narrador genera una biblia de campaña única.
- **Trasfondo y personalidad:** al crear la campaña, el narrador analiza lo que escribió el jugador y define de 3 a 4 ganchos personales (cómo cada detalle del pasado o del carácter aparecerá en la trama). Si el trasfondo está vacío, se inventa uno coherente. Los ganchos forman parte de la biblia de campaña y se tienen en cuenta en cada turno; el trasfondo y la personalidad se muestran en la ficha del héroe.
- **Turnos:** en cada turno se envían la biblia, la ficha, el estado, las misiones, la crónica de hechos clave y el historial reciente. El narrador responde en JSON estructurado con la narración, los cambios de estado y, si procede, una tirada requerida.
- **Tiradas:** el juego realiza las tiradas d20 (atributo + competencia contra CD); la narración solo describe la consecuencia.
- **Salas en grupo:** de 1 a 6 jugadores, cada uno desde su dispositivo, comparten una campaña propia de la sala.
  - El anfitrión crea su personaje y obtiene un código de 6 caracteres; el resto entra con el código o con el enlace de invitación (`?sala=CÓDIGO`) y crea su personaje para esa sala.
  - El anfitrión inicia la aventura cuando quiera. El narrador diseña la campaña a partir de los trasfondos de todos los héroes, con ganchos personales para cada uno y algún hilo que cruza sus pasados.
  - **Rondas de acciones:** cada jugador recibe sus propias opciones y envía su acción (puede cambiarla mientras la ronda siga abierta). Las acciones no se muestran hasta que la ronda se resuelve. Cuando han actuado todos los jugadores conectados, el narrador resuelve la ronda de una vez. El anfitrión puede resolverla antes; si no está conectado, puede hacerlo cualquier otro jugador.
  - **Tiradas por héroe:** el narrador pide tiradas solo a quien las necesita; las de los jugadores ausentes se hacen automáticamente.
  - **Presencia:** quien cierra la página o pierde la conexión aparece como ausente y la ronda no le espera; su héroe sigue con el grupo en segundo plano.
  - Se puede entrar en una sala ya empezada: el narrador presenta al nuevo héroe en la siguiente ronda.
  - Un único dispositivo consulta al narrador en cada ronda (reserva atómica en la base de datos). Si ese dispositivo se desconecta a mitad, otro retoma la ronda pasados 150 segundos. Si el narrador falla, todos ven el aviso y cualquiera puede reintentar.
  - Las salas en las que se ha participado aparecen en el inicio para volver a entrar.
- **Estilo narrativo:** cada campaña recibe una voz de narrador propia (seca, irónica, sobria, cruda, de taberna o cinematográfica) y una lista de nombres de personas y lugares creada con sílabas de dos culturas y topónimos con concordancia de género. Las instrucciones del narrador piden prosa concreta, diálogos con voz propia, comienzos variados y opciones en primera persona, y prohíben muletillas y nombres repetidos habituales en textos generados. Si la narración termina preguntando al jugador qué hace, esa pregunta se elimina.
- **Gráficos procedurales:** todo se dibuja en el navegador a partir de semillas, sin imágenes externas ni coste adicional:
  - Retrato del héroe en busto con la cabeza ligeramente girada y luz lateral. Combina 7 formas de cara, 5 formas de ojos, 7 narices, 6 expresiones, 4 edades (arrugas y canas), 4 complexiones, 15 peinados, 8 tipos de barba, ropa con variantes por clase (hombreras, correas, cuellos, estolas, pieles, gorgueras), un objeto de clase a la espalda (espada, escudo, arco, báculo, laúd…), marcas, accesorios y un sello rúnico propio: cada personaje es único.
  - Sexo del personaje (hombre o mujer): cambia los rasgos del retrato (mandíbula, cuello, hombros, cejas, pestañas, labios, peinados y barba más habituales), las etiquetas de raza y clase («Elfa Exploradora») y la concordancia gramatical de la narración. Los personajes de la historia también tienen sexo.
  - Personalización opcional en la creación (piel, pelo, ojos, ropa, peinado, barba, marca, accesorio, edad, complexión, forma del rostro, expresión y tocado) sobre el aspecto aleatorio.
  - Sobrenombre del héroe generado por la historia según su trasfondo.
  - Retratos de personajes y criaturas, con marco rojo si son hostiles. Las criaturas tienen especies y formas propias: lobos, osos, felinos, jabalíes y cuervos; esqueletos, zombis y espectros; demonios con distintos cuernos; dragones con cuernos y alas variables; gólems, armaduras animadas y seres de madera; espíritus de varias formas.
  - Escena animada del lugar actual según bioma, momento del día y clima (lluvia, nieve, niebla, tormenta, brasas, luciérnagas, oleaje, etc.).
  - Mapa del mundo propio de cada partida, con niebla que se revela al viajar y la ruta recorrida.
- **Navegación:** en ordenador, barra lateral con iconos (Partidas, Nuevo, Grupo, Héroe, Mapa, Personajes) que se puede plegar y recuerda su estado; en tablet y móvil, barra inferior fija con icono y texto, donde Historia, Héroe, Mapa y Personajes ocupan la pantalla completa.
- **Interfaz:** estética rúnica con animaciones (dado d20, narración progresiva, efectos de daño y subida de nivel). Respeta la opción del sistema de reducir movimiento.
- **Guardado:** las partidas en solitario se almacenan en el navegador (`localStorage`) y pueden exportarse o importarse en JSON. Las salas se guardan en Firebase y se conservan hasta que se borran desde la consola.
