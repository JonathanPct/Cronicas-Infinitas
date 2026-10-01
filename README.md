# Crónicas Infinitas

RPG de fantasía inspirado en Dungeons & Dragons en el que Gemini actúa como Dungeon Master. Cada personaje recibe una campaña propia (mundo, antagonista, secreto y trama en cuatro actos) que evoluciona según sus decisiones.

## Estructura

```
├── index.html   # Juego completo; se publica en GitHub Pages
├── Codigo.gs    # Proxy de Gemini; se pega en Google Apps Script (GitHub Pages no lo ejecuta)
└── README.md
```

## Gestión de la clave de Gemini

La clave **no se guarda en ningún archivo del repositorio**. Se almacena en las Propiedades del script de Google Apps Script, que son privadas. El juego llama al proxy de Apps Script y este añade la clave antes de reenviar la petición a Gemini.

Si una clave de Google aparece en un repositorio público de GitHub, Google la detecta y la revoca automáticamente. Con este diseño el repositorio puede ser público sin riesgo.

## Configuración del proxy (una sola vez)

1. Abrir https://script.google.com y crear un **Proyecto nuevo**.
2. Sustituir el contenido de `Código.gs` por el de `Codigo.gs` y guardar.
3. En **Configuración del proyecto** (icono de engranaje) → **Propiedades del script** → **Añadir propiedad del script**:
   - Propiedad: `GEMINI_API_KEY`
   - Valor: la clave de Google AI Studio
4. **Implementar** → **Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Autorizar los permisos solicitados y copiar la **URL de la aplicación web** (termina en `/exec`).
6. Pegar esa URL en `index.html`, en la línea:

   ```js
   const GEMINI_PROXY_URL = 'https://script.google.com/macros/s/.../exec';
   ```

7. Comprobación: al abrir la URL `/exec` en el navegador debe aparecer `{"ok":true,"claveConfigurada":true}`.

### Propiedades opcionales

| Propiedad | Descripción | Valor por defecto |
|---|---|---|
| `GEMINI_MODEL` | Modelos separados por comas, en orden de preferencia; si uno no está disponible o está saturado se usa el siguiente y el saturado se omite durante 10 minutos | `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` |
| `GEMINI_TEMPERATURE` | Creatividad de la narración | `1.0` |
| `LIMITE_POR_MINUTO` | Peticiones máximas por minuto en total | `60` |

Los cambios en las propiedades se aplican al momento. Los cambios en el código del script requieren **Implementar → Gestionar implementaciones → Editar → Nueva versión**, manteniendo así la misma URL.

## Publicación en GitHub Pages

Subir los archivos a la raíz del repositorio y activar Pages en **Settings → Pages** (rama `main`, carpeta raíz). `Codigo.gs` se incluye como referencia: no contiene la clave ni ningún otro dato sensible.

## Funcionamiento

- **Creación de campaña:** a partir del personaje, su trasfondo y unas semillas aleatorias (tema, giro y ambientación), Gemini genera una biblia de campaña única.
- **Trasfondo y personalidad:** al crear la campaña, el narrador analiza lo que escribió el jugador y define de 3 a 4 ganchos personales (cómo cada detalle del pasado o del carácter aparecerá en la trama). Si el trasfondo está vacío, se inventa uno coherente. Los ganchos forman parte de la biblia de campaña y se tienen en cuenta en cada turno; el trasfondo y la personalidad se muestran en la ficha del héroe.
- **Turnos:** en cada turno se envían la biblia, la ficha, el estado, las misiones, la crónica de hechos clave y el historial reciente. Gemini responde en JSON estructurado con la narración, los cambios de estado y, si procede, una tirada requerida.
- **Tiradas:** el juego realiza las tiradas d20 (atributo + competencia contra CD); la narración solo describe la consecuencia.
- **Estilo narrativo:** cada campaña recibe una voz de narrador propia (seca, irónica, sobria, cruda, de taberna o cinematográfica) y una lista de nombres de personas y lugares creada con sílabas de dos culturas y topónimos con concordancia de género. Las instrucciones del narrador piden prosa concreta, diálogos con voz propia, comienzos variados y opciones en primera persona, y prohíben muletillas y nombres repetidos habituales en textos generados. Si la narración termina preguntando al jugador qué hace, esa pregunta se elimina.
- **Gráficos procedurales:** todo se dibuja en el navegador a partir de semillas, sin imágenes externas ni coste adicional:
  - Retrato del héroe con rasgos continuos (tono de piel, color de pelo y ojos, proporciones de la cara, nariz, boca, cejas, ropa), 11 peinados, 6 tipos de barba, marcas, accesorios y un sello rúnico propio: cada personaje es único.
  - Sexo del personaje (hombre o mujer): cambia los rasgos del retrato (mandíbula, cuello, hombros, cejas, pestañas, labios, peinados y barba más habituales), las etiquetas de raza y clase («Elfa Exploradora») y la concordancia gramatical de la narración. Los personajes de la historia también tienen sexo.
  - Personalización opcional en la creación (piel, pelo, ojos, ropa, peinado, barba, marca, accesorio y tocado) sobre el aspecto aleatorio.
  - Sobrenombre del héroe generado por la historia según su trasfondo.
  - Retratos de personajes y criaturas (humanoides, bestias, no muertos, demonios, dragones, constructos y espíritus), con marco rojo si son hostiles.
  - Escena animada del lugar actual según bioma, momento del día y clima (lluvia, nieve, niebla, tormenta, brasas, luciérnagas, oleaje, etc.).
  - Mapa del mundo propio de cada partida, con niebla que se revela al viajar y la ruta recorrida.
- **Navegación:** en ordenador, barra lateral con iconos (Partidas, Nuevo, Héroe, Mapa, Personajes) que se puede plegar y recuerda su estado; en tablet y móvil, barra inferior fija con icono y texto, donde Historia, Héroe, Mapa y Personajes ocupan la pantalla completa.
- **Interfaz:** estética rúnica con animaciones (dado d20, narración progresiva, efectos de daño y subida de nivel). Respeta la opción del sistema de reducir movimiento.
- **Guardado:** las partidas se almacenan en el navegador (`localStorage`) y pueden exportarse o importarse en JSON.
