import { Show } from "solid-js";

// Modale de confirmation générique (engagement au PAPS, validations admin).
export function ConfirmDialog(props) {
  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        onClick={props.onCancel}
      >
        <div
          class="bg-white rounded-md shadow-lg p-4 max-w-md w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 class="font-bold text-lg mb-2">{props.title}</h3>
          <div class="text-sm text-gray-700 flex flex-col gap-2">{props.children}</div>
          <div class="flex gap-2 mt-4">
            <button
              class="flex-1 border rounded p-2 font-bold cursor-pointer"
              onClick={props.onCancel}
            >Annuler</button>
            <button
              class="flex-1 bg-vf text-white rounded p-2 font-bold cursor-pointer"
              onClick={props.onConfirm}
            >{props.confirmLabel || "Confirmer"}</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
