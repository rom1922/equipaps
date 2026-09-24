import { createSignal, Show } from "solid-js";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { useNavigate } from "@solidjs/router";
import { BackButton, LinkButton } from "../components/utils";
import { isAdmin, adminHeaders } from "../res/admin";

export default function EventForm() {
  const navigate = useNavigate();

  const [name, setName] = createSignal("");
  const [date, setDate] = createSignal("");
  const [paps, setPaps] = createSignal("");
  const [location, setLocation] = createSignal("");
  const [participants, setParticipants] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [status, setStatus] = createSignal("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/createevent", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: name(),
          date: new Date(date()).toISOString(),
          paps: new Date(paps()).toISOString(),
          location: location(),
          participants: participants(),
          description: description(),
        }),
      });
      if (r.status === 401) { setStatus("Session expirée. Reconnecte-toi dans l'espace bureau."); return; }
      const res = await r.json();
      if (res.success === false) {
        setStatus(res.message || "Erreur lors de l'enregistrement. Merci de réessayer.");
        return;
      } else {
        setStatus("Événement enregistré !");
        navigate(`/event/${res.id}`);
      }
    } catch (err) {
      setStatus("Erreur lors de l'enregistrement.");
    }
  };

  return (
    <Layout floating={true}>
      <MetaProvider>
        <Title>Créer un événement</Title>
      </MetaProvider>
      <div class="flex flex-col w-full">
        <BackButton/>
        <h2 class="text-2xl font-bold mb-4">Créer un événement</h2>
        <Show when={isAdmin()} fallback={<p class="text-gray-700">Réservé au bureau. <LinkButton href="/admin">Se connecter</LinkButton></p>}>
        <form onSubmit={handleSubmit} class="flex flex-col gap-3">
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
          <label>Ouverture de l'équi-PAPS</label>
          <input
            type="datetime-local"
            value={paps()}
            onInput={e => setPaps(e.target.value)}
            required
            class="border rounded p-2"
          />
          <button type="submit" class="bg-vf text-white rounded p-2 font-bold cursor-pointer">Enregistrer</button>
        </form>
        </Show>
        {status() && <div class="mt-2 text-center">{status()}</div>}
      </div>
    </Layout>
  );
}