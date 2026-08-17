import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      purpose={"Keep every promise to pay in one place, with the date it was promised for, instead of a note typed into a spreadsheet column."}
      contents={[
              "Each promise records who made it, how much, and the date they said they would pay.",
              "Promises are grouped into coming up, due today, and broken.",
              "When a promised date passes with no payment, the tenant comes back onto your list automatically.",
              "This replaces the Update column in the current spreadsheet, which today holds notes such as Payment by 29.05.26 and Offset SD.",
              "Payment is confirmed by the tenant disappearing from next month's bank report, because the system does not connect to the bank."
      ]}
    />
  );
}
