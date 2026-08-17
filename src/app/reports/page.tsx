import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      purpose={"Produce the reports that go out on a schedule, and the clean file that gets loaded back into NetSuite."}
      contents={[
              "Security deposit report for CSD, every Monday.",
              "Industry breakdown for management, on the first working day of the month.",
              "Outstanding balance lists for each relationship manager.",
              "One file covering every email sent, call made and promise recorded, ready to upload into NetSuite."
      ]}
      blockedOn={"Whether these come straight from the AR report or are put together from other documents. The two relationship manager worksheets in the sample give the same tenant code different company names, so they look like stand in data rather than the real thing."}
    />
  );
}
