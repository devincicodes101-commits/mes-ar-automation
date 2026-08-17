import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      title="Settings & Audit Trail"
      purpose={"Configuration, user management and the permanent record of who did what."}
      contents={[
              "Email template library with version history.",
              "Users and roles: CSD, Relationship Manager and Management.",
              "Access enforced by Supabase row level security at the data layer, not in the browser.",
              "Audit log of every send, call, promise and export, with timestamp and actor.",
              "Late fee rule configuration, once MES confirms it."
      ]}
      blockedOn={"The late payment fee rule. The sample data shows a flat charge repeating monthly plus a separate rejected GIRO fee, which contradicts the percentage figure used in the earlier flow deck."}
    />
  );
}
