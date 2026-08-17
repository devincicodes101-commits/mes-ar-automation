import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      purpose={"Write the reminder emails for you, then let you read and change each one before it goes out. Nothing is ever sent on its own."}
      contents={[
              "Standard wording you can edit and save yourself, without asking a developer.",
              "The tenant name, the amount owed and how overdue it is are filled in for you.",
              "You read the email, change anything you want, then press send.",
              "Where a tenant has several finance contacts, all of them are included.",
              "Every email sent is recorded, and goes into the file you load back into NetSuite."
      ]}
      blockedOn={"The wording MES currently uses for the statement, the first reminder, the final notice and the 1FM letter. Also the full list of tenant email addresses. Right now only 8 of 53 tenants have one on file."}
    />
  );
}
