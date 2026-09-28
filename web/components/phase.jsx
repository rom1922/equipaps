import { createSignal, onCleanup, Show } from "solid-js";

// Phase dérivée d'un événement : le temps et la clôture font l'état, jamais la
// plénitude (liste d'attente maintenue — décision Vicente 2026-09-24 ; « plein »
// n'est pas « fermé »). `closed` = l'événement a eu lieu, gagnants figés.
//   upcoming : avant l'ouverture — « Équi-PAPS débute dans … » (rouge pastel)
//   window   : fenêtre prioritaire — « Équi-PAPS en cours · PAPS débute dans … »
//              (orange pastel) ; sa durée vient du bureau (ev.fenetre, défaut 24 h)
//   draw     : vrai PAPS, premier arrivé premier servi (vert pastel)
//   ended    : clôturé / passé (gris)
export function eventPhase(ev, now = new Date()) {
  const paps = new Date(ev.paps);
  const date = new Date(ev.date);
  const f = Number(ev.fenetre);
  const fenetre = Number.isFinite(f) && f >= 1 ? f : 24;
  const deadline = new Date(paps.getTime() + fenetre * 60 * 60 * 1000);
  if (ev.closed || now >= date) return { key: "ended", label: "Terminé", tone: "muted" };
  if (now < paps) return { key: "upcoming", label: "Équi-PAPS débute dans", at: paps, tone: "wait" };
  if (now < deadline) return { key: "window", label: "Équi-PAPS en cours", atLabel: "PAPS débute dans", at: deadline, tone: "accent" };
  return { key: "draw", label: "PAPS ouvert", tone: "open" };
}

// Compte à rebours vivant (affiché tant que la cible est dans le futur).
export function Countdown(props) {
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));
  const left = () => new Date(props.at).getTime() - now();
  const fmt = () => {
    const ms = left();
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
          m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
    if (m > 0) return `${m} min ${String(sec).padStart(2, "0")} s`;
    return `${sec} s`;
  };
  return <Show when={fmt()} fallback={props.fallback || null}><span class="tabular-nums">{fmt()}</span></Show>;
}

// Badge de phase, réutilisé par la liste et la page événement (user ET
// bureau) : rectangle net (pas de pilule), tons pastel — rouge avant
// l'ouverture, orange pendant l'équi-PAPS, vert au vrai PAPS, gris terminé.
export function PhaseChip(props) {
  const ph = () => eventPhase(props.ev);
  return (
    <span
      class="inline-flex items-center gap-1 text-xs font-semibold rounded-none px-2 py-0.5 whitespace-nowrap"
      classList={{
        "bg-gray-200 text-gray-700": ph().tone === "muted",
        "bg-red-100 text-red-800": ph().tone === "wait",
        "bg-orange-100 text-orange-800": ph().tone === "accent",
        "bg-green-100 text-green-800": ph().tone === "open",
      }}
    >
      {ph().label}
      <Show when={ph().at}>
        <span class="font-normal">{ph().atLabel ? ` · ${ph().atLabel}` : " · "} <Countdown at={ph().at}/></span>
      </Show>
    </span>
  );
}

// Badge de type : chaque événement est une « sortie » ou un « atelier »,
// et le tirage équilibre séparément les deux compteurs (un élève très servi
// en ateliers n'est pas défavorisé sur les sorties, et inversement).
export function TypeChip(props) {
  const atelier = () => props.ev?.type === "atelier";
  return (
    <span class="inline-flex items-center text-xs font-semibold rounded-none px-2 py-0.5 whitespace-nowrap"
      classList={{
        "bg-indigo-100 text-indigo-800": atelier(),
        "bg-gray-100 text-gray-700": !atelier(),
      }}
    >
      {atelier() ? "Atelier" : "Sortie"}
    </span>
  );
}
