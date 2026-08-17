import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      purpose={"Where the email wording, the user accounts and the record of everything done are kept."}
      contents={[
              "Edit and save the standard email wording, with a history of past versions.",
              "Add and remove users, and set whether they are CSD, a relationship manager, or management.",
              "What each person can see is controlled at the database, not just hidden in the screen.",
              "A permanent record of every email sent, call logged, promise recorded and file exported, with who did it and when.",
              "The late payment fee amount, once MES confirms how it is worked out."
      ]}
      blockedOn={"How the late payment fee is calculated. The sample data shows the same flat charge repeating each month, plus a separate charge when a payment is rejected. That does not match the percentage figure used in the earlier slide deck."}
    />
  );
}
