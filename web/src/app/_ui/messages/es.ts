/**
 * Every text of the app, in Spanish: the same shape as `en.ts`. The explanations the server
 * writes in English (record links, mapping reasons) are translated by pattern; one with no
 * pattern is shown as it is.
 */
import { fieldSpec, isFieldName } from "@/lib/schema/fields";

import type { Messages } from "./en";

/** A field's name as the screens show it, for the server's texts that use its key. */
const fieldLabel = (name: string) => (isFieldName(name) ? fieldSpec(name).label_es : name);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CHOSEN: Record<string, string> = { patient: "El paciente elegido", physician: "El médico elegido", insurer: "La mutua elegida" };

const SERVER: [RegExp, (...m: string[]) => string][] = [
  // Why a document cannot be approved yet (lib/batches/decide.ts).
  [/^(\w+) is required$/, (name) => `${fieldLabel(name)}: es obligatorio`],
  [/^(\w+) is not in its form: (.*)$/, (name, value) => `${fieldLabel(name)}: «${value}» no tiene la forma del campo`],
  [/^(\w+) is (red|orange): change or confirm it$/, (name, s) => `${fieldLabel(name)} está en ${s === "red" ? "rojo" : "naranja"}: cámbialo o confírmalo`],
  [/^(\w+) is (red|orange) with no value: choose or type one$/, (name, s) => `${fieldLabel(name)} está en ${s === "red" ? "rojo" : "naranja"} y sin valor: elige uno o escríbelo`],
  [/^(\w+) (.+) is already registered: reject the document as a duplicate$/, (name, value) => `${fieldLabel(name)} ${value} ya está registrado: recházalo como duplicado`],
  [/^another tab works as (.+) now: reload the page$/, (name) => `otra pestaña trabaja ahora como ${name}: recarga la página`],
  [/^a request needs at least one test: keep or add one$/, () => "una petición necesita al menos una prueba: conserva o añade una"],
  [/^the chosen (patient|physician|insurer) (.+) is not a record of its kind$/, (kind, id) => `${CHOSEN[kind]}, ${id}, no es un registro de ese tipo`],
  // Record links (lib/fusion/link.ts).
  [/^identity document and name or birth date agree$/, () => "coinciden el documento de identidad y el nombre o la fecha de nacimiento"],
  [
    /^the identity document matches a record whose name and birth date do not$/,
    () => "el documento de identidad coincide con un registro cuyo nombre y fecha de nacimiento no coinciden",
  ],
  [/^there is no identity document on the form$/, () => "el volante no trae documento de identidad"],
  [/^the identity document matches no record$/, () => "el documento de identidad no coincide con ningún registro"],
  [/^name and birth date match one record$/, () => "el nombre y la fecha de nacimiento coinciden con un registro"],
  [/^name and birth date match (\d+) records$/, (n) => `el nombre y la fecha de nacimiento coinciden con ${n} registros`],
  [/^the name matches (\d+) record\(s\) but no birth date does$/, (n) => `el nombre coincide con ${n} registro(s), pero ninguna fecha de nacimiento`],
  [
    /^the birth date matches and the name is close to (\d+) record\(s\)$/,
    (n) => `la fecha de nacimiento coincide y el nombre se parece a ${n} registro(s)`,
  ],
  [/^no record matches: a patient the lab has not seen$/, () => "ningún registro coincide: un paciente nuevo para el laboratorio"],
  [/^registration number and name agree$/, () => "coinciden el número de colegiado y el nombre"],
  [/^the registration number matches a record with another name$/, () => "el número de colegiado coincide con un registro de otro nombre"],
  [/^the name matches one record$/, () => "el nombre coincide con un registro"],
  [/^the name matches (\d+) records$/, (n) => `el nombre coincide con ${n} registros`],
  [/^no record matches: a physician the lab does not know$/, () => "ningún registro coincide: un médico que el laboratorio no conoce"],
  [/^the name matches a registered insurer$/, () => "el nombre coincide con una mutua registrada"],
  [/^the name matches (\d+) insurers$/, (n) => `el nombre coincide con ${n} mutuas`],
  [/^the document names no insurer$/, () => "el volante no nombra ninguna mutua"],
  [/^the insurer is not registered in the LIS$/, () => "la mutua no está registrada en el LIS"],
  [/^chosen by the technician$/, () => "elegido por el técnico"],
  // Why the mapping model could not be asked (batches/pipeline.ts).
  [/^no recorded reply for this request$/, () => "no hay respuesta grabada para esta consulta"],
  [/^no mapping model is configured$/, () => "no hay ningún modelo de mapeo configurado"],
  [/^the technician says there is no record: a new one$/, () => "el técnico indica que no hay registro: es nuevo"],
  // How a record is described (api/documents/[id]/proposal).
  [/^(.+) · born (.+)$/, (doc, date) => `${doc} · nacido/a el ${date}`],
  [/^No\. (.+)$/, (n) => `N.º ${n}`],
  // Mapping reasons (lib/mapping/propose.ts, document.ts).
  [/^approved with (\d+) different meanings for this insurer$/, (n) => `aprobada con ${n} significados distintos para esta mutua`],
  [/^approved (\d+) times? for this insurer$/, (n) => `aprobada ${n} ${n === "1" ? "vez" : "veces"} para esta mutua`],
  [/^approved (\d+) time\(s\) for this insurer$/, (n) => `aprobada ${n} ${n === "1" ? "vez" : "veces"} para esta mutua`],
  [/^corrected (\d+) times$/, (n) => `corregida ${n} ${n === "1" ? "vez" : "veces"}`],
  [/^approved (\d+) time\(s\) for other insurers$/, (n) => `aprobada ${n} ${n === "1" ? "vez" : "veces"} para otras mutuas`],
  [/^closest catalog entry: (.+)$/, (label) => `la entrada más parecida del catálogo: ${label}`],
  [/^no catalog entry stands out$/, () => "ninguna entrada del catálogo destaca"],
  [/^nothing in the catalog looks like it$/, () => "nada del catálogo se le parece"],
  [/^chosen by the model among the catalog candidates$/, () => "elegida por el modelo entre los candidatos del catálogo"],
  [/^the model found no candidate that fits$/, () => "el modelo no encontró ningún candidato que encaje"],
];

/** One explanation, translated clause by clause (they are joined with "; " or ", "). */
function server(text: string): string {
  const one = (part: string) => {
    for (const [re, to] of SERVER) {
      const m = re.exec(part.trim());
      if (m) return to(...m.slice(1));
    }
    return null;
  };
  const whole = one(text);
  if (whole) return whole;
  for (const sep of ["; ", ", "]) {
    const parts = text.split(sep).map(one);
    if (parts.length > 1 && parts.every((p) => p !== null)) return parts.join(sep);
  }
  return text;
}

export const es: Messages = {
  locale: "es-ES",
  language: { label: "Idioma", en: "English", es: "Español" },
  fieldLabel: (spec) => spec.label_es,

  common: {
    batches: "Lotes",
    switchTechnician: "Cambiar de técnico",
    demo: "Demo",
    demoLong: (speed) => `Demo · respuestas grabadas, ${speed}× más rápido`,
    demoTitle: (speed) =>
      `Las respuestas reales de los modelos, grabadas antes y reproducidas ${speed}× más rápido. No se envía nada a ningún modelo; tu trabajo queda en un espacio aislado solo tuyo.`,
    live: "En vivo",
    liveLong: "En vivo · se llama a los modelos ahora",
    remove: "Quitar",
    documents: (n) => plural(n, "documento"),
    retrying: "se vuelve a intentar sola",
    tryAgain: "Reintentar",
  },

  states: {
    queued: "En cola",
    extracting: "Leyendo",
    failed: "Fallido",
    awaiting_verification: "Por verificar",
    in_verification: "En verificación",
    approved: "Aprobado",
    rejected: "Rechazado",
  },
  lights: { green: "verde", orange: "naranja", red: "rojo", grey: "gris" },
  providers: { gemini: "Modelo Cloud", local: "Modelo Local" },

  entry: {
    demoBadge: "Demo · datos sintéticos",
    eyebrow: "Peticiones de laboratorio clínico, con una persona en el bucle",
    title: ["El modelo lee. Los registros comprueban.", "Una persona decide."],
    lead: "El técnico deja de teclear volantes escaneados y pasa a verificarlos. Cada valor llega con un semáforo y su procedencia; el modelo es una fuente más, nunca la fuente de verdad.",
    heroAlt: "Un volante de laboratorio escaneado cuyos campos fluyen a un panel de verificación, cada uno con una luz verde, ámbar o roja y una marca de comprobación",
    steps: [
      { title: "Leer", text: "Un modelo de visión lee el volante escaneado, campo a campo, y dice dónde encontró cada valor." },
      { title: "Comprobar", text: "Los registros del laboratorio confirman o contradicen lo leído. Cuando discrepan, no gana el modelo." },
      { title: "Mapear", text: "Cada prueba pedida, escrita a la manera de la mutua, recibe los códigos del laboratorio." },
      { title: "Aprobar", text: "Nada cuenta hasta que un técnico lo aprueba: quién, cuándo y qué exactamente." },
    ],
    lightsTitle: "El semáforo",
    lightsNote: "Un color es una señal, nunca una aceptación.",
    lights: ["Coincide con los registros del laboratorio", "Solo lo dice el modelo", "Discrepan: decides tú", "Ausente, y opcional"],
    figures: [
      "precisión por campo, Modelo Cloud",
      "errores de lectura mostrados en verde",
      "líneas de pruebas que quedan para el técnico",
      "documentos enlazados al paciente equivocado",
    ],
    start: "Empezar a trabajar",
    startNote: "Elige qué técnico eres. Personas inventadas: esto no es un inicio de sesión.",
    replayNote: (speed) =>
      `Las respuestas reales de los modelos se grabaron antes y se reproducen ${speed}× más rápido. Tus lotes quedan un día en un espacio aislado solo tuyo.`,
    opening: "Abriendo…",
    startOver: "Empezar de cero",
    startOverNote: "Un espacio nuevo: sin lotes, y con la memoria que tendría un laboratorio con algo de historial.",
    startOverConfirm: "Se borrarán tus lotes y todo lo que hayas aprobado aquí. ¿Empezar de cero?",
    continue: "Seguir donde lo dejaste",
    role: "Técnico de laboratorio",
    footer:
      "Todos los documentos, personas y mutuas de aquí son sintéticos, generados por el proyecto. Cifras medidas: 200 peticiones sintéticas, leídas y comprobadas de principio a fin.",
  },

  log: {
    button: "Registro de decisiones",
    buttonTitle: "Por qué se propuso cada valor y cada código, y qué se hizo (Alt+L)",
    title: "Registro de decisiones",
    subtitle: "Cómo llegó la cadena a cada propuesta, y qué hizo el técnico con ella.",
    close: "Cerrar",
    why: "¿Por qué?",
    hide: "Ocultar",
    sections: {
      reading: "Lectura",
      records: "Los registros del laboratorio",
      fields: "Campos",
      mapping: "Pruebas solicitadas",
      decision: "Decisión",
      yours: "Tu trabajo, aún sin aprobar",
    },
    steps: {
      read: "Leído",
      records: "Registros",
      compare: "Comparación",
      rule: "Regla",
      proposed: "Propuesta",
      memory: "Memoria",
      elsewhere: "Otras mutuas",
      search: "Catálogo",
      model: "Modelo",
      result: "Resultado",
      you: "Técnico",
    },
    lights: { green: "verde", orange: "naranja", red: "rojo", grey: "gris" },
    extractor: (model, prompt, mode) =>
      `${model}, versión de prompt ${prompt}, ${mode === "page-images" ? "leyendo las páginas como imágenes" : "leyendo el PDF directamente"}.`,
    attempts: (n, seconds, recorded) => `${n === 1 ? "Un intento" : `${n} intentos`}, ${seconds} s${recorded ? ", respuesta grabada reproducida" : ""}.`,
    boxes: (ocr, model) => `Dónde está cada valor: ${ocr} colocados con exactitud por el OCR de la página${model > 0 ? `, ${model} aproximados por el modelo` : ""}.`,
    boxesModel: "Dónde está cada valor: según lo colocó el modelo, exacto con este modelo.",
    warnings: (list) => `Avisos: ${list}.`,
    noWarnings: "Sin avisos.",
    empty: (list) => `No se encontraron en el documento, así que quedan vacíos en vez de inventarse: ${list}.`,
    matchedOn: (keys) => `Coinciden en: ${keys}.`,
    keys: { doc_id: "documento de identidad", name: "nombre", birth_date: "fecha de nacimiento", close_name: "un nombre parecido", colegiado: "número de colegiado" },
    candidates: (n) => `${n} registros se le parecen; ninguno se toma sin el técnico.`,
    chosenByYou: "Lo puso el técnico, buscando en los registros.",
    readValue: (v, page) => `El modelo leyó «${v}»${page ? ` en la página ${page}` : ""}.`,
    notRead: "No se leyó en el documento.",
    readWarnings: (codes) => `Con un aviso: ${codes}.`,
    recordValue: (v, who, confirmed) => `${who} guarda «${v}»${confirmed ? "." : ", un registro no confirmado como el de este documento."}`,
    noRecordField: "Los registros del laboratorio no guardan este campo.",
    noRecordLinked: "No hay registro enlazado, así que los registros no pueden confirmarlo.",
    modes: {
      exact: "tal cual",
      casefold: "sin mayúsculas ni acentos",
      digits: "por sus dígitos",
      alnum_upper: "por sus letras y dígitos",
      phone: "como teléfonos",
      person_name: "como nombres, con el nombre o los apellidos delante",
    },
    compared: (mode, a, b, same) => `${mode}: «${a}» y «${b}», ${same ? "iguales" : "distintos"}.`,
    alias: "Coincide con otro nombre con el que está registrada la mutua.",
    rule: (reason, light) => `${reason}: ${light}.`,
    proposedFrom: (v, from) => `«${v}», ${from}.`,
    storedAs: "guardado como número, como lo guarda el laboratorio",
    noneProposed: "Nada: decide el técnico.",
    lineRead: (t, page) => `«${t}»${page ? `, página ${page}` : ""}.`,
    scope: (who) => `Buscado entre las aprobaciones de ${who}.`,
    scopeName: (name) => `la mutua impresa como «${name}» (no registrada)`,
    scopeNone: "los documentos sin mutua",
    memoryNone: "Nunca aprobada para esta mutua.",
    memoryEntry: (codes, active, passive, corrections) =>
      `${codes}: aprobada ${active} ${active === 1 ? "vez" : "veces"} por un técnico que actuó, ${passive} tal como se mostraba en verde${corrections ? `, sustituida ${corrections} ${corrections === 1 ? "vez" : "veces"}` : ""}.`,
    memoryGreen: (n) => `Aprobada ${n} veces, de forma activa y sin contradicciones: verde.`,
    memoryOrange: "Aprobada, pero no las veces suficientes o con contradicciones: naranja.",
    memoryConflict: (n) => `Aprobada con ${n} significados distintos: rojo, elige el técnico.`,
    memoryPassive: "Solo aprobada tal como se mostraba en verde, que puede ser confianza en el color: no se usa.",
    elsewhereNone: "Tampoco aprobada para otras mutuas.",
    elsewhereUsed: (codes, n) => `Aprobada ${n} ${n === 1 ? "vez" : "veces"} para otras mutuas como ${codes}: una sugerencia, naranja.`,
    notConsulted: "No hizo falta: lo resolvió la memoria.",
    searchTop: (list) => `Entradas más parecidas: ${list}.`,
    searchRule: (score, lead, minScore, minLead, stands) =>
      `La mejor puntúa ${score} y aventaja en ${lead}; se propone si llega a ${minScore} y aventaja en ${minLead}: ${stands ? "destaca, naranja" : "ninguna destaca, rojo"}.`,
    searchNothing: "Nada del catálogo se le parece: rojo.",
    modelAnswer: (codes) => `Eligió ${codes} entre los candidatos de la línea, con todo el volante como contexto: naranja.`,
    modelNone: "No encontró ningún candidato que encaje: la línea sigue en rojo.",
    modelUnavailable: (error) => `No se pudo consultar (${server(error)}): la línea sigue en rojo.`,
    modelNotNeeded: "No consultado: al modelo solo van las líneas que quedan en rojo.",
    modelAsked: (model, lines, cached) =>
      `Se consultó al ${model} por ${lines} ${lines === 1 ? "línea roja" : "líneas rojas"}${cached ? ", desde sus respuestas grabadas" : ""}.`,
    language: (lang) => `El idioma del volante no se lee; al modelo se le dijo ${lang === "es" ? "español" : lang}.`,
    noTrace: "Este documento se procesó antes de que se guardara el registro: no se sabe qué tenía la memoria entonces ni cómo se consultó al modelo.",
    result: (light, codes, source) => `${light}: ${codes}, ${source}.`,
    resultNone: (light) => `${light}: sin códigos propuestos.`,
    youChanged: (v) => `Cambiado a «${v}».`,
    youEmptied: "Dejado vacío.",
    youConfirmed: "Confirmado tal como se propuso.",
    youPending: "Pendiente de cambiar o confirmar.",
    youCovered: "Verde: lo cubre la aprobación de toda la petición.",
    youCodes: (codes) => `Puestos ${codes}.`,
    youDropped: "Descartada: no es una prueba, o no se pidió.",
    youAdded: "Añadida por el técnico: no se leyó.",
    actions: {
      kept: "aprobado tal como se propuso",
      confirmed: "confirmado tal como se propuso",
      changed: "cambiado",
      corrected: "corregido",
      chosen: "códigos elegidos",
      dropped: "descartado",
      added: "añadido",
    },
    approvedSummary: (who, when) => `Aprobado por ${who} el ${when}.`,
    rejectedSummary: (who, when) => `Rechazado por ${who} el ${when}.`,
    actionCounts: (list) => `Qué se hizo: ${list}.`,
    nothingYet: "Aún no se ha cambiado ni confirmado nada.",
    linkSet: (kind, title) => `${kind} enlazado a mano a ${title}.`,
    linkNone: (kind) => `${kind}: sin registro, es nuevo.`,
  },

  deleteBatch: {
    button: "Borrar lote",
    buttonTitle: "Borrar este lote y todo lo que dejó",
    title: (name) => `¿Borrar «${name}»?`,
    all: "Borrar todos",
    allTitle: "Borrar todos los lotes y todo lo que dejaron",
    titleAll: (n) => (n === 1 ? "¿Borrar el único lote?" : `¿Borrar los ${n} lotes?`),
    readingAll: (n) => (n === 1 ? "El lote que aún se está leyendo se queda." : `Los ${n} lotes que aún se están leyendo se quedan.`),
    confirmAll: "Borrarlos todos",
    documents: (n) => `Se borran ${n === 1 ? "su documento" : `sus ${n} documentos`} y lo que se propuso para ${n === 1 ? "él" : "ellos"}.`,
    documentsAll: (n) => `Se borran ${n === 1 ? "su documento" : `sus ${n} documentos`} y lo que se propuso para ${n === 1 ? "él" : "ellos"}.`,
    decided: (approved, rejected) =>
      `También ${approved} ${approved === 1 ? "aprobación" : "aprobaciones"} y ${rejected} ${rejected === 1 ? "rechazo" : "rechazos"}, y las peticiones que las aprobaciones registraron en mock-lis.`,
    memory: "Lo que la memoria del mapeo de pruebas aprendió de sus aprobaciones se conserva.",
    reading: "Aún se están leyendo documentos: bórralo cuando terminen.",
    cancel: "Cancelar",
    confirm: "Borrar el lote",
    deleting: "Borrando…",
  },

  batches: {
    subtitle: "Cada documento se lee, se comprueba contra los registros del laboratorio y se mapea a sus códigos; después te espera.",
    newBatch: "Nuevo lote",
    tiles: { toVerify: "Por verificar", reading: "Leyendo", approved: "Aprobados", failed: "Fallidos" },
    emptyTitle: "Todavía no hay lotes",
    emptyText: "Mete unas cuantas peticiones sintéticas en un lote y mira cómo se leen, se comprueban y se mapean.",
    emptyAction: "Crea tu primer lote",
    toVerify: (n) => `${n} por verificar`,
  },

  newBatch: {
    title: "Nuevo lote",
    subtitle: "Elige quién lo lee y qué peticiones entran. Pasan a la cola en cuanto lo creas.",
    whoReads: "Quién lo lee",
    providers: {
      gemini: { text: "Un modelo en la nube. Lee el PDF directamente.", meta: "99,8 % de precisión por campo · unos 9 s por documento" },
      local: {
        text: "Pesos abiertos en la GPU de esta máquina. Nada sale de la máquina.",
        meta: "99,5 % de precisión por campo · unos 80 s por documento",
      },
    },
    synthetic: "Peticiones sintéticas",
    syntheticReplay: (provider) => `Las que tienen una respuesta grabada del ${provider}.`,
    syntheticLive: "Generadas por el proyecto, con su verdad de referencia.",
    filter: "Filtrar por nombre",
    random: (n) => `Añadir ${n} al azar`,
    clear: "Vaciar",
    columns: { document: "Documento", pages: "Páginas", kind: "Tipo", lang: "Idioma" },
    include: (name) => `Incluir ${name}`,
    scanned: "Escaneado",
    digital: "Digital",
    handwriting: "Manuscrito",
    yourPdfs: "Tus PDF",
    yourPdfsHint: "Se guardan en esta máquina, fuera del repositorio, y los lee el modelo que elegiste.",
    choosePdfs: "Elige los PDF que subir",
    pdfLimit: "Hasta 20 MB cada uno",
    name: "Nombre del lote",
    namePlaceholder: "Opcional, p. ej. Correo de la mañana",
    inBatch: "En este lote",
    nothingYet: "Nada todavía: marca unas cuantas peticiones.",
    readBy: (provider) => `Lo lee el ${provider}`,
    creating: "Creando…",
    create: (n) => (n > 0 ? `Crear y leer ${plural(n, "documento")}` : "Crear y leer"),
  },

  batch: {
    reading: "Leyendo los documentos…",
    ready: "Listo para verificar",
    progress: "Progreso",
    read: (done, total) => `${done} de ${total} leídos`,
    toVerify: "Por verificar",
    meanTime: "Lectura media",
    columns: { document: "Documento", state: "Estado", fields: "Campos", tests: "Líneas de pruebas", read: "Lectura" },
    retry: "Reintentar",
    recorded: "grabada",
    recordedTitle: (speed) => `El tiempo que tardó el modelo al grabarse; aquí se reproduce ${speed}× más rápido.`,
    attempt: (n) => `intento ${n}`,
    verify: "Verificar",
    view: "Ver",
    note: "Los colores son señales, nunca aceptaciones: verde significa una propuesta con evidencia sólida, pendiente de aprobar.",
  },

  verify: {
    batch: "Lote",
    previous: "Anterior",
    next: "Siguiente",
    previousTitle: "Documento anterior",
    nextTitle: (file) => `Documento siguiente: ${file}`,
    lastTitle: "Último documento del lote",
    position: (at, total) => [String(at), ` de ${total}`],
    readBy: (model, seconds) => `leído por el ${model} en ${seconds} s`,
    recorded: " (grabado)",
    readOnly: (message) => `${message}. Se muestra en solo lectura.`,
    lockedBy: (holder) => `${holder} está verificando este documento`,
    closed: (message) => server(message),
    notReserved: (message) => `No se ha podido reservar el documento para ti (${message}); se vuelve a intentar`,
    takeOver: (name) => `Tomar el relevo como ${name}`,
    records: "Los registros del laboratorio",
    fieldsTitle: (n) => `Campos · ${n}`,
    testsTitle: (read, added) =>
      `Pruebas solicitadas · ${plural(read, "línea")} ${read === 1 ? "leída" : "leídas"}${added > 0 ? `, ${added} ${added === 1 ? "añadida" : "añadidas"}` : ""}`,
    leftToResolve: (n) => `${n} por resolver o confirmar`,
    nextPending: "Siguiente elemento por resolver o confirmar (Alt+N)",
    prevPending: "Elemento anterior por resolver o confirmar (Alt+Mayús+N)",
    nothingLeft: "Listo para aprobar",
    noTests: "No queda ninguna prueba: conserva o añade al menos una",
    changes: (n) => plural(n, "cambio"),
    confirmedCount: (n) => `${n} ${n === 1 ? "confirmado" : "confirmados"}`,
    lens: (on) => `Lupa ${on ? "activada" : "desactivada"}`,
    lensTitle: "Pasa el puntero por un valor de «Leído» para ver dónde se leyó, ampliado y unido a la página (Alt+Z)",
    shortcuts: "Atajos de teclado",
    leave: "Dejar para luego",
    approve: "Aprobar",
    approving: "Aprobando…",
    approveReady: "Aprobar exactamente lo que se ve: queda registrado con tu nombre (Ctrl+Intro)",
    approveBlocked: "Antes resuelve o confirma cada elemento rojo y naranja",
    notApproved: "No se ha podido aprobar:",
    reject: "Rechazar…",
    rejectTitle: "Rechazar este documento",
    rejectNote: "El documento y su propuesta se conservan; el rechazo queda registrado con tu nombre.",
    rejectReasons: { illegible: "Ilegible", not_a_request: "No es una petición de laboratorio", duplicate: "Duplicado", other: "Otro motivo" },
    note: "Nota",
    notePlaceholder: "Opcional; obligatoria con «Otro motivo»",
    cancel: "Cancelar",
    rejecting: "Rechazando…",
    confirm: "Confirmar tal como se propone (Alt+Intro)",
    confirmedTitle: "Confirmado: pincha para deshacer",
    approvedBy: (name, when) => `Aprobado por ${name} el ${when}.`,
    approvedNote: "Lo que se ve es lo que se aprobó, tal como quedó registrado.",
    rejectedBy: (name, when) => `Rechazado por ${name} el ${when}`,
    backToBatch: "Volver al lote",
    confirmLeave: "Tus cambios en este documento aún no están aprobados y se perderán. ¿Salir de todos modos?",
    shortcutsTitle: "Atajos de teclado",
    shortcutsHint: "Pulsa ? en cualquier momento para abrir o cerrar esta lista.",
    close: "Cerrar",
    keyGroups: [
      {
        title: "Moverse",
        keys: [
          ["Alt+↓ / Alt+↑", "Campo o línea siguiente o anterior"],
          ["Tab / Mayús+Tab", "Casilla siguiente o anterior"],
          ["Alt+N / Alt+Mayús+N", "Siguiente o anterior elemento por resolver o confirmar"],
          ["Alt+→ / Alt+←", "Documento siguiente o anterior del lote"],
        ],
      },
      {
        title: "Decidir",
        keys: [
          ["Alt+1 / Alt+2", "En un conflicto, tomar el valor del documento o el de los registros"],
          ["Alt+Intro", "Confirmar el elemento tal como se propone e ir al siguiente por revisar"],
          ["Ctrl+Intro", "Aprobar, cuando no quede nada por resolver ni confirmar"],
        ],
      },
      {
        title: "Ver",
        keys: [
          ["Alt+Z", "Activar o desactivar la lupa: el origen del valor, ampliado y unido a la página"],
          ["Alt+L", "El registro de decisiones: por qué se propuso cada valor y cada código"],
          ["?", "Abrir o cerrar esta lista"],
          ["Esc", "Salir de la casilla; cerrar esta lista"],
        ],
      },
    ],
    keysNote: "En una página, pincha una caja para ir a su campo.",
    keysSwitch: "desde la cabecera.",
  },

  records: {
    patient: "Paciente",
    physician: "Médico",
    insurer: "Mutua",
    lookAlike: (n) => `${n} registros se le parecen`,
    search: { patient: "Buscar en los pacientes del laboratorio", physician: "Buscar en los médicos del laboratorio", insurer: "Buscar en las mutuas del laboratorio" },
    searchHint: {
      patient: "Nombre, documento de identidad, fecha de nacimiento o teléfono",
      physician: "Nombre o número de colegiado",
      insurer: "Nombre o código",
    },
    noRecord: { patient: "Sin registro: un paciente nuevo", physician: "Sin registro: un médico que el laboratorio no conoce", insurer: "Sin registro: una mutua no registrada" },
    chosen: "Elegido por ti",
    reset: "Volver a lo encontrado",
    nothingFound: "Ningún registro coincide",
    typeToSearch: "Escribe para buscar en los registros",
    linking: "Comparando con el registro…",
  },

  links: { linked: "Enlazado", candidate: "Candidato", ambiguous: "Ambiguo", none: "Sin registro" },

  fields: {
    columns: { field: "Campo", read: "Leído", records: "Registros", proposed: "Propuesto", selected: "Seleccionado" },
    groups: { patient: "Paciente", physician: "Médico", request: "Petición", insurer: "Mutua" },
    sources: { lis: "de los registros", ai: "del documento", default: "por defecto" },
    from: (source) => source,
    page: (n) => `p. ${n}`,
    candidate: "candidato",
    noneChoose: "Ninguno: eliges tú",
    choose: "Elige o escribe",
    notInForm: "No tiene la forma del campo: una fecha que exista, dd/mm/aaaa, un sexo H, M o U",
    pick: "Seleccionar este valor",
    changed: "Cambiado por ti",
  },

  reasons: {
    agree: "El documento y los registros del laboratorio coinciden",
    lis_only: "No está en el documento; tomado de los registros del laboratorio",
    ai_only: "Solo en el documento: los registros no pueden confirmarlo",
    ai_only_doubtful: "Solo en el documento, y la lectura parece dudosa",
    conflict: "El documento y los registros discrepan: elige",
    candidate_agrees: "Coincide con un registro aún no confirmado como de este paciente",
    candidate_only: "Solo en un registro aún no confirmado como de este paciente",
    default: "El valor por defecto del sistema",
    missing_required: "Falta, y es obligatorio",
    absent_optional: "Ausente, y opcional",
  },

  tests: {
    columns: { read: "Leído", proposed: "Propuesto", selected: "Seleccionado" },
    noLines: "No se leyó ninguna línea de pruebas.",
    noPage: "sin página",
    noneChoose: "Ninguno: eliges tú",
    dropped: "Descartada: no es una prueba, o no se pidió",
    drop: "Descartar la línea: no es una prueba, o no se pidió",
    undo: "Deshacer: mantener la línea",
    added: "Añadida por ti",
    addedNote: "Añadida por ti · no leída",
    addedPlaceholder: "Como lo dice el volante (opcional)",
    addedLabel: "La prueba como la dice el volante",
    nothingProposed: "Nada propuesto",
    removeAdded: "Quitar esta prueba",
    add: "Añadir una prueba que la lectura no encontró",
  },

  mappingSource: {
    memory: "Aprobada antes para esta mutua",
    memory_elsewhere: "Aprobada antes para otras mutuas",
    search: "La mejor coincidencia del catálogo",
    model: "Elegida por el modelo entre los candidatos del catálogo",
  },

  codes: {
    remove: (code) => `Quitar ${code}`,
    removeTitle: "Quitar este código",
    add: "Añadir un código",
    addTitle: "Añadir un código del catálogo",
    choose: "Elige los códigos",
    back: "Volver a lo propuesto",
    search: "Buscar en el catálogo: nombre o código",
    searchLabel: "Buscar en el catálogo",
    close: "Cerrar la búsqueda",
    catalog: "Catálogo",
    candidates: "Candidatos para esta línea",
    profile: (n) => `perfil · ${n} pruebas`,
    searching: "Buscando…",
    nothing: "Nada del catálogo se le parece",
    typeToSearch: "Escribe para buscar en todo el catálogo",
  },

  viewer: {
    pages: (n) => plural(n, "página"),
    page: (n) => `página ${n}`,
    exact: "exacta",
    approximate: "aproximada",
    zoomIn: "Ampliar",
    zoomOut: "Reducir",
    pageAlt: (n) => `Página ${n}`,
    boxExact: "Donde se leyó",
    boxApprox: "Aproximada: la colocó el modelo local",
    approx: "aprox.",
  },

  lens: {
    testLine: (n) => `Línea de prueba ${n}`,
    page: (n) => `p. ${n}`,
    approx: " · aprox.",
  },

  server,
};

/** A document's state as the screens name it, for the server's texts that use its key. */
const stateLabel = (state: string) => (es.states as Record<string, string>)[state]?.toLowerCase() ?? state;
const colour = (light: string) => (light === "red" ? "rojo" : light === "orange" ? "naranja" : light);

/** The server's errors and refusals that name a document's state or a line, in Spanish. */
SERVER.push(
  [/^the document is (\w+), not awaiting verification$/, (state) => `el documento está ${stateLabel(state)}, no pendiente de verificación`],
  [/^no proposal yet; the document is (\w+)$/, (state) => `aún no hay propuesta: el documento está ${stateLabel(state)}`],
  [/^only a failed document can be retried; this one is (\w+)$/, (state) => `solo se puede reintentar un documento fallido; este está ${stateLabel(state)}`],
  // Why a document cannot be approved yet: its lines and added tests (lib/batches/decide.ts).
  [/^line (\d+) \((.*)\) is (red|orange): change or confirm it$/, (n, text, light) => `la línea ${n} (${text}) está en ${colour(light)}: cámbiala o confírmala`],
  [/^line (\d+) \((.*)\) has no codes$/, (n, text) => `la línea ${n} (${text}) no tiene códigos`],
  [/^line (\d+) \((.*)\): not in the catalog: (.+)$/, (n, text, codes) => `la línea ${n} (${text}): no están en el catálogo: ${codes}`],
  [/^added test (\d+) has no codes$/, (n) => `la prueba añadida ${n} no tiene códigos`],
  [/^added test (\d+): not in the catalog: (.+)$/, (n, codes) => `la prueba añadida ${n}: no están en el catálogo: ${codes}`],
  [/^expected (\d+) read lines, got (\d+)$/, (want, got) => `se esperaban ${want} líneas leídas y llegaron ${got}`],
  // Other refusals the screens show (app/api).
  [/^the document is not in verification by you$/, () => "el documento no está en verificación a tu nombre"],
  [/^not ready to approve$/, () => "todavía no se puede aprobar"],
  [/^no such document$/, () => "no existe ese documento"],
  [/^no proposal for this document$/, () => "este documento no tiene propuesta"],
  [/^say why in a note$/, () => "explica el motivo en una nota"],
  [/^(.+) is verifying this document$/, (who) => `${who} está verificando este documento`],
  [/^pick a technician first \(POST \/api\/session\)$/, () => "elige primero un técnico"],
  // When the server could not be reached, or failed (_ui/api.ts).
  [/^the server does not answer: try again in a few seconds$/, () => "el servidor no responde: vuelve a intentarlo en unos segundos"],
  [/^the server failed: try again in a few seconds$/, () => "el servidor ha fallado: vuelve a intentarlo en unos segundos"],
  [/^send at most (\d+) bytes(, with their length)?$/, (n) => `la petición es demasiado grande: como mucho ${Math.round(Number(n) / 1024)} KB`],
  [/^file exceeds (\d+) bytes$/, (n) => `el fichero es demasiado grande: como mucho ${Math.round(Number(n) / 1048576)} MB`],
  [/^invalid PDF: .*$/, () => "el fichero no es un PDF válido"],
  [/^no such batch$/, () => "el lote no existe"],
  [/^a document is being read; delete the batch once it is read$/, () => "se está leyendo un documento: borra el lote cuando termine"],
  // Why a document could not be read (lib/batches/queue.ts).
  [/^the database was busy: retry the document$/, () => "la base de datos estaba ocupada: reintenta el documento"],
  [/^the database could not save it: retry the document$/, () => "la base de datos no pudo guardarlo: reintenta el documento"],
  [/^the document's file could not be read$/, () => "no se pudo leer el fichero del documento"],
  [/^every sandbox is in use: try again later$/, () => "la demo está llena: vuelve a intentarlo dentro de un rato"],
  [/^too many new sandboxes from this address: try again later$/, () => "demasiadas sesiones nuevas desde esta dirección: vuelve a intentarlo dentro de un rato"],
  [/^at most (\d+) documents queued or being read at once: wait for some to be read$/, (n) => `como mucho ${n} documentos en cola o leyéndose a la vez: espera a que se lean algunos`],
  [/^at most (\d+) documents per batch$/, (n) => `como mucho ${n} documentos por lote`],
  [/^a batch needs at least one document$/, () => "un lote necesita al menos un documento"],
);
