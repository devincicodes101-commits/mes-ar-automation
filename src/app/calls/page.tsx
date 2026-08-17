import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      purpose={"Give you the list of tenants to phone on the 14th and 15th, and a short form to fill in afterwards so nothing gets forgotten."}
      contents={[
              "The list is ordered so the most urgent tenants come first.",
              "Before you dial, the screen already shows the name, the amount owed, when their payment failed and how overdue it is.",
              "After the call you note who you spoke to, what they agreed, and when to check back.",
              "You phone from your normal office line, so there is no call charge and nothing new to learn.",
              "Each call is saved with the date and time, ready to load into NetSuite."
      ]}
    />
  );
}
