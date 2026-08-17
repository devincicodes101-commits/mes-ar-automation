import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      title="Promise to Pay Tracker"
      purpose={"Turn payment promises into dated records instead of free text typed into a spreadsheet column."}
      contents={[
              "Every commitment stored with a date, an amount and the person who gave it.",
              "States: upcoming, due today, and broken.",
              "Automatic follow up when a promised date passes without payment.",
              "Replaces the Update column in the current AR workbook, which today holds entries such as Payment by 29.05.26 and Offset SD.",
              "Payment is confirmed by absence from the following month's DBS report, since there is no live bank connection."
      ]}
    />
  );
}
