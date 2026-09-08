# clinical-intake-verifier — Guía para Claude Code

> Copiar este fichero a la **raíz del repositorio** y abrir sesión de Claude Code allí.

## Qué es este proyecto

Un sistema de **entrada de peticiones clínicas asistida por IA**, con verificación humana en el bucle. Se escanea un volante médico, un modelo de visión extrae los datos, y un operador **verifica y corrige** en vez de transcribir.

**No es un extractor de PDFs.** Eso es commodity. Lo que este proyecto demuestra es una postura de ingeniería concreta:

> **La IA no es la fuente de verdad. Es una fuente más, y no la de mayor prioridad.**

Cuando el modelo y el sistema de registro discrepan, **no gana la IA**: el campo se marca en rojo y decide una persona. Todo lo que se construya aquí debe ser coherente con esa idea.

## Por qué existe

Es una pieza de **portfolio profesional** de Nicolás Barceló, reconstruida **desde cero** a partir de un problema real de digitalización clínica. Objetivo: demostrar criterio de ingeniería sobre sistemas con LLM en producción — evaluación sistemática, human-in-the-loop y gestión de la incertidumbre — no demostrar que se sabe llamar a una API de visión.

## ⛔ Reglas duras

1. **NUNCA commitear volantes reales ni datos de pacientes.** El `.gitignore` debe estar en el **primer commit**, antes de que ningún documento entre en la carpeta. Los volantes de desarrollo viven **fuera del árbol del repositorio**. Son datos de salud: categoría especial del RGPD.
2. **NUNCA nombrar clientes, empresas ni sistemas propietarios reales** en código, commits, documentación o interfaz. Ni razones sociales, ni nombres de LIS comerciales, ni rutas internas. El LIS simulado se llama `mock-lis` y punto.
3. **NUNCA copiar código de otros repositorios.** Este proyecto se escribe **desde cero**. Se pueden reutilizar ideas y decisiones de diseño; no líneas de código. Es lo que hace que el resultado sea inequívocamente propio.
4. **Los datos de la demo son sintéticos**, generados por el propio proyecto. Nunca anonimizados a partir de reales.

## Arquitectura

```
volante (PDF)
    ↓
[1] Extractor  ──── Gemini Flash ───→  JSON + bounding boxes
    ↓
[2] Mock LIS  ──── SQLite ──────────→  paciente / médico / aseguradora
    ↓
[3] Motor de fusión  ───────────────→  campos con procedencia y confianza
    ↓
[4] UI de verificación  ────────────→  operador confirma o corrige
    ↓
        petición validada
```

Y en paralelo, fuera del flujo:

```
[5] Generador de volantes sintéticos  →  PDFs de prueba + verdad de referencia
[6] Harness de evaluación             →  métricas por campo contra el golden sample
```

### El truco que conviene entender pronto

**El generador sintético produce el golden sample gratis.** Si el proyecto genera el volante, sabe exactamente qué dice — así que la verdad de referencia no hay que etiquetarla a mano. Eso permite ejecutar la evaluación en cada commit, que es lo que convierte esto en ingeniería y no en una demo.

## Motor de fusión — el corazón

Prioridad de fuentes, de mayor a menor:

1. **LIS** (dato de registro ya existente)
2. **IA** (extraído del documento)
3. **Defaults** del sistema

Semáforo por campo:

| Situación | Estado |
|---|---|
| IA y LIS coinciden | 🟢 verde |
| Solo LIS | 🟢 verde |
| Solo IA | 🟠 naranja |
| **IA y LIS difieren** | 🔴 **rojo — decide el operador** |
| Sin dato, campo obligatorio | 🔴 rojo |
| Sin dato, campo opcional | ⚪ gris |

Cada campo arrastra su procedencia: qué dijo la IA, qué dijo el LIS, de dónde salió el valor final, y quién lo tocó. **Esa trazabilidad es parte del producto**, no un extra.

## Stack

| Capa | Elección |
|---|---|
| App + API | **Next.js** (App Router, TypeScript) |
| UI | React + Tailwind |
| Extracción | Gemini Flash vía SDK de Google en route handler |
| Persistencia | SQLite + Drizzle |
| Demo pública | Vercel |
| Generador sintético y evaluación | **Python** (reportlab para los PDF) |

Next.js en vez de React a secas: despliegue de una pieza en Vercel, API routes sin backend aparte, y es lo que hace que la demo sea *pública y ejecutable* en vez de un vídeo. Python queda solo para lo que es naturalmente Python: generar PDFs y calcular métricas.

## Campos de la v1

Los del prompt de la prueba de concepto. Todos con **bounding box** y **número de página**:

`Paciente` · `FechaNacimiento` · `Edad` · `Sexo` · `DocumentoIdentidad` · `Telefono` · `NombreMedico` · `NumeroColegiado` · `NumeroPeticion` · `NombreMutua` · `NumeroSolicitudMutua` · `NumeroAutorizacion` · `NumeroTarjeta` · `tests[]`

Reglas de extracción heredadas del piloto, que funcionaron:

- **Solo JSON.** Nada de texto fuera del objeto.
- **Sin alucinar**: si un campo no está claramente presente → `null`. Nunca inventar.
- **Texto exacto**: no normalizar valores extraídos, salvo fecha de nacimiento (`dd/mm/yyyy`) y sexo (`H`/`M`/`U`).
- **Cada prueba, una entrada independiente** en `tests[]`. **Nunca** inferir agrupación a partir de cajas, bordes o tablas del documento.
- Números de petición repetidos → devolver una sola vez.

## Fases

Pensadas para bloques de 90 minutos, no para semanas.

- **F1 · Generador sintético.** PDFs de volante realistas con sus datos de referencia en JSON. Sin esto no hay demo pública ni evaluación.
- **F2 · Extractor.** Llamada a Gemini con salida estructurada y bboxes. Contra los sintéticos primero.
- **F3 · Harness de evaluación.** Métricas por campo contra el golden sample. **Antes que la UI** — así cada cambio posterior se mide.
- **F4 · Mock LIS + motor de fusión.** SQLite sintético y la lógica del semáforo. Aquí está el valor real.
- **F5 · UI de verificación.** Visor con bounding boxes, formulario, navegación por teclado.
- **F6 · Demo en Vercel + README.** La pieza que se enseña.

⚠️ **F3 va antes que F5 a propósito.** Es tentador saltar a la interfaz porque es lo que se ve; pero sin métricas no se sabe si un cambio de prompt mejora o empeora, y ese es justo el punto que el proyecto quiere demostrar.

## Convenciones

- Documentación y README **en inglés** (es un portfolio internacional); commits en inglés.
- Conventional commits.
- El repo debe poder clonarse y ejecutarse **sin credenciales** salvo una API key de Gemini, documentada en `.env.example`.
- Todo lo que sea configuración de campos (nombres, obligatoriedad, tipo, regex) vive en **un solo sitio**, no repartido entre prompt, backend y UI.
