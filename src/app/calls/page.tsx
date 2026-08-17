import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      title="Calling List & Call Log"
      purpose={"Produce the mid month calling list for the 14th and 15th, and capture what was agreed on each call."}
      contents={[
              "Prioritised list drawn from the collections queue, worst first.",
              "Capture form pre filled with client name, amount owed, deduction fail date and aging bucket.",
              "Fields for who was reached, what was agreed, and the next action date.",
              "Officers call from their existing MES line, so there is no per minute telephony cost.",
              "Each completed call saved as a structured dated record, exportable for NetSuite."
      ]}
    />
  );
}
