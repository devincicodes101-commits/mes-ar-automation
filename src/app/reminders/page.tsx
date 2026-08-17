import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      title="Reminder Drafting & Review"
      purpose={"Draft the 7th reminder and the 21st final notice from configurable templates, then hold them for the officer to approve. Nothing sends itself."}
      contents={[
              "Template editor so CSD can change the wording and save it, without a developer.",
              "Draft preview with the account name, balance and aging bucket merged in.",
              "Edit before send, then an explicit approve step. Human in the loop is a contracted requirement.",
              "Multi recipient handling, since contact records hold several addresses separated by semicolons.",
              "Every send written to the audit trail and included in the NetSuite export."
      ]}
      blockedOn={"The current SOA, first reminder, final notice and 1FM templates, and the master tenant email list. Only 8 of 53 accounts currently have an address on file."}
    />
  );
}
