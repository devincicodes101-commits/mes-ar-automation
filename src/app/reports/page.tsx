import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      title="Reports & Export"
      purpose={"Generate the recurring departmental reports and the clean export that goes back into NetSuite."}
      contents={[
              "Security deposit reconciliation for CSD, every Monday.",
              "Industry segment analysis for management, on the first working day.",
              "RM outstanding balance logs, ongoing.",
              "NetSuite export covering every email sent, call logged and promise captured."
      ]}
      blockedOn={"Confirmation of whether these reports are pulled from the AR report or assembled from other source documents. The RM worksheets in the sample give the same customer code different company names, so they look like placeholder data."}
    />
  );
}
