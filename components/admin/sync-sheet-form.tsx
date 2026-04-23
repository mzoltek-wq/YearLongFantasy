"use client";

type SyncSheetFormProps = {
  action: (formData: FormData) => Promise<void>;
};

export function SyncSheetForm({ action }: SyncSheetFormProps) {
  return (
    <button
      className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
      formAction={action}
      type="submit"
      onClick={(event) => {
        const confirmed = window.confirm(
          "Syncing from Google Sheets will reset the entire draft in the app, clear entered picks, and rebuild the board from the sheet. Continue?",
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      Sync keepers from sheet
    </button>
  );
}
