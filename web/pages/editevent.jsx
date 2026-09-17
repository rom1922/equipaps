import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { useNavigate, useParams } from "@solidjs/router";
import { BackButton, dateForDateTimeInputValue } from "../components/utils";
import { User } from "../components/user"
import { RosterSearch } from "../components/rostersearch";

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
  const [status, setStatus] = createSignal("");

  createEffect(() => {
    if (ev()) {
      setName(ev().name);
      setDate(dateForDateTimeInputValue(new Date(ev().date)));
      setPaps(dateForDateTimeInputValue(new Date(ev().paps)));
      setLocation(ev().location);
      setParticipants(ev().participants);
      setDescription(ev().description);
      setPxxs(ev().users.map(user => user.pxx) || []);
    }
  })

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const password = prompt("Entrez le mot de passe pour modifier l'événement :");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password || ""));
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

      var res = await (await fetch("/api/editevent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: params.id,
          name: name(),
          date: date(),
          paps: paps(),
          location: location(),
          participants: participants(),
          description: description(),
          users: pxxs(),
          hash: hashHex
        }),
      })).json();
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
    if (pxxs().includes(r.pxx)) return;
    setPxxs(pxxs => [...pxxs, r.pxx]);
    setStatus("");
  };

  const handleRemove = async (e) => {
    e.preventDefault();
    try {
      const password = prompt("Entrez le mot de passe pour supprimer l'événement :");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password || ""));
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

      var res = await (await fetch("/api/removeevent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: params.id,
          hash: hashHex,
        }),
      })).json();
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

  const closeEvent = async (e) => {
    e.preventDefault();
    try {
      const password = prompt("Entrez le mot de passe pour modifier l'événement :");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password || ""));
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

      var res = await (await fetch("/api/closeevent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: params.id,
          hash: hashHex
        }),
      })).json();

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
            <label>Inscrits (hors accompagnants) : cliquer sur un nom pour le retirer</label>
            <div>
              <For each={pxxs()}>
                {(user, i) => (
                  <div class="inline-block cursor-pointer" onClick={() => setPxxs(pxxs => pxxs.filter(u => u !== user))}>
                    <Show when={i() < participants()} fallback={<User user={{pxx: user}} state={0}/>}>
                      <User user={{pxx: user}} state={1}/>
                    </Show>
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

        <Show when={ev() && new Date() > new Date(ev().paps)}>
          <button type="submit" class="bg-black/60 text-white rounded p-2 mb-1 font-bold cursor-pointer" onClick={closeEvent}>Fermer le PAPS</button>
        </Show>

        <button type="submit" class="bg-rf text-white rounded p-2 font-bold cursor-pointer" onClick={handleRemove}>Supprimer l'évènement</button>
        {status() && <div class="mt-2 text-center">{status()}</div>}

      </div>
    </Layout>
  );
}