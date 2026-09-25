import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { useNavigate, useParams } from "@solidjs/router";
import { BackButton, LinkButton, dateForDateTimeInputValue, promoLabel } from "../components/utils";
import { RosterSearch } from "../components/rostersearch";
import { isAdmin, adminHeaders } from "../res/admin";

async function fetchEvent(id) {
  const res = await fetch(`/api/event/${id}`);
  if (!res.ok) throw new Error("Événement introuvable");
  return await res.json();
}

export default function EventForm() {
  const navigate = useNavigate();
  const params = useParams();

  const [ev, { mutate, refetch }] = createResource(params.id, fetchEvent);

  const [name, setName] = createSignal("");
  const [date, setDate] = createSignal("");
  const [paps, setPaps] = createSignal("");
  const [location, setLocation] = createSignal("");
  const [participants, setParticipants] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [pxxs, setPxxs] = createSignal([]);
  const [names, setNames] = createSignal({});
  const [status, setStatus] = createSignal("");

  const label = (u) => (u.prenom || u.nom)
    ? `${u.prenom || ''} ${u.nom || ''}`.trim() + (u.promo ? ` (${promoLabel(u.promo)})` : '')
    : u.pxx;

  createEffect(() => {
    if (ev()) {
      setName(ev().name);
      setDate(dateForDateTimeInputValue(new Date(ev().date)));
      setPaps(dateForDateTimeInputValue(new Date(ev().paps)));
      setLocation(ev().location);
      setParticipants(ev().participants);
      setDescription(ev().description);
      setPxxs(ev().users.map(user => user.pxx) || []);
      setNames(Object.fromEntries((ev().users || []).map(u => [u.pxx, label(u)])));
    }
  })

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/editevent", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          id: params.id,
          name: name(),
          date: new Date(date()).toISOString(),
          paps: new Date(paps()).toISOString(),
          location: location(),
          participants: participants(),
          description: description(),
          users: pxxs(),
        }),
      });
      if (r.status === 401) { setStatus("Session expirée. Reconnecte-toi dans l'espace bureau."); return; }
      var res = await r.json();
      if (res.success === false) {
        setStatus(res.message || "Erreur lors de l'enregistrement. Merci de réessayer.");
        return;
      } else {
        setStatus("Événement enregistré !");
        navigate(`/event/${res.id}`);
      }
    } catch (err) {
      console.log(err);
      setStatus("Erreur lors de l'enregistrement.");
    }
  };

  const addUser = (r) => {
    if (!r?.pxx) return;
    setNames(n => ({ ...n, [r.pxx]: label(r) }));
    if (pxxs().includes(r.pxx)) return;
    setPxxs(pxxs => [...pxxs, r.pxx]);
    setStatus("");
  };

  const handleRemove = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/removeevent", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: params.id }),
      });
      if (r.status === 401) { setStatus("Session expirée. Reconnecte-toi dans l'espace bureau."); return; }
      var res = await r.json();
      if (res.success === false) {
        setStatus(res.message || "Erreur lors de la suppression. Merci de réessayer.");
        return;
      } else {
        setStatus("Événement supprimé !");
        navigate(`/listevents`);
      }
    } catch (err) {
      console.log(err);
      setStatus("Erreur lors de la suppression.");
    }
  };

  const openEvent = async (e) => {
    e.preventDefault();
    try {
      const password = prompt("Entrez le mot de passe pour rouvrir l'événement :");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password || ""));
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");

      var res = await (await fetch("/api/openevent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: params.id,
          hash: hashHex
        }),
      })).json();

      if (res.success === false) {
        setStatus(res.message || "Erreur lors de la réouverture de l'événement. Merci de réessayer.");
        return;
      } else {
        setStatus("Événement rouvert !");
        navigate(`/event/${res.id}`);
      }
    } catch (err) {
      console.log(err);
      setStatus("Erreur lors de l'enregistrement.");
    }
  }

  const closeEvent = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/closeevent", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: params.id }),
      });
      if (r.status === 401) { setStatus("Session expirée. Reconnecte-toi dans l'espace bureau."); return; }
      var res = await r.json();

      if (res.success === false) {
        setStatus(res.message || "Erreur lors de la fermeture de l'événement. Merci de réessayer.");
        return;
      } else {
        setStatus("Événement fermé !");
        navigate(`/event/${res.id}`);
      }
    } catch (err) {
      console.log(err);
      setStatus("Erreur lors de l'enregistrement.");
    }
  }

  return (
    <Layout floating={true}>
      <MetaProvider>
        <Title>Edition - {name()}</Title>
      </MetaProvider>
      <div class="flex flex-col w-full">
        <BackButton/>
        <h2 class="text-2xl font-bold mb-4">Edition - {name()}</h2>
        <Show when={isAdmin()} fallback={<p class="text-gray-700">Réservé au bureau. <LinkButton href="/admin">Se connecter</LinkButton></p>}>
        <form onSubmit={handleSubmit} class="flex flex-col gap-3 mb-1">
          <input
            type="text"
            placeholder="Nom de l'événement"
            value={name()}
            onInput={e => setName(e.target.value)}
            required
            class="border rounded p-2"
          />
          <input
            type="datetime-local"
            value={date()}
            onInput={e => setDate(e.target.value)}
            required
            class="border rounded p-2"
          />
          <input
            type="text"
            placeholder="Lieu"
            value={location()}
            onInput={e => setLocation(e.target.value)}
            required
            class="border rounded p-2"
          />
          <input
            type="number"
            placeholder="Nombre de participants (hors accompagnants)"
            value={participants()}
            onInput={e => setParticipants(e.target.value)}
            required
            class="border rounded p-2"
          />
          <textarea
            placeholder="Description"
            value={description()}
            onInput={e => setDescription(e.target.value)}
            class="border rounded p-2"
          />

          <div class="flex flex-col gap-3 mb-1 bg-black/10 p-2 rounded-md">
            <label>Ouverture de l'équi-PAPS</label>
            <input
              type="datetime-local"
              value={paps()}
              onInput={e => setPaps(e.target.value)}
              required
              class="border rounded p-2"
            />
            <label>Inscrits (hors accompagnants) : cliquer pour retirer. Les {participants() || 0} premiers sont retenus, le reste en attente.</label>
            <div class="flex flex-col gap-1">
              <For each={pxxs()}>
                {(user, i) => (
                  <div
                    onClick={() => setPxxs(pxxs => pxxs.filter(u => u !== user))}
                    title="Cliquer pour retirer"
                    classList={{
                      'flex items-center gap-2 rounded px-2 py-1 cursor-pointer': true,
                      'bg-vc/25': i() < participants(),
                      'bg-black/5': i() >= participants(),
                    }}
                  >
                    <span class="text-xs text-gray-500 w-5 text-right shrink-0">{i() + 1}</span>
                    <span class="flex-grow text-sm truncate">{names()[user] || user}</span>
                    <span class="text-xs shrink-0" classList={{ 'text-vf font-bold': i() < participants(), 'text-gray-500': i() >= participants() }}>
                      {i() < participants() ? '✓ retenu' : 'en attente'}
                    </span>
                    <span class="text-gray-400 shrink-0">×</span>
                  </div>
                )}
              </For>
            </div>

            <div class="flex flex-col gap-3">
              <RosterSearch onSelect={addUser} placeholder="Ajouter un élève par son nom" />
            </div>
          </div>

          <button type="submit" class="bg-vf text-white rounded p-2 font-bold cursor-pointer">Enregistrer</button>
        </form>

        <Show when={ev() && new Date() > new Date(ev().paps) && !ev().closed}>
          <button type="submit" class="bg-black/60 text-white rounded p-2 mb-1 font-bold cursor-pointer" onClick={closeEvent}>Fermer le PAPS</button>
        </Show>
        <Show when={ev() && ev().closed}>
          <button type="submit" class="bg-green-600 text-white rounded p-2 mb-1 font-bold cursor-pointer" onClick={openEvent}>Rouvrir le PAPS</button>
        </Show>

        <button type="submit" class="bg-rf text-white rounded p-2 font-bold cursor-pointer" onClick={handleRemove}>Supprimer l'évènement</button>
        </Show>
        {status() && <div class="mt-2 text-center">{status()}</div>}

      </div>
    </Layout>
  );
}