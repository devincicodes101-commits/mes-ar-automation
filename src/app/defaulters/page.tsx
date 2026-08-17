import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      title="Recurring Defaulter View"
      purpose={"Surface the chronic risk accounts whose GIRO fails month after month."}
      contents={[
              "Accounts ranked by how often their GIRO has failed across billing periods.",
              "Late fee count per account, which the sample data shows as a flat charge each month it recurs.",
              "Balance trend across periods once more than one upload exists.",
              "Feeds the Phase 2 predictive layer once enough production history accumulates."
      ]}
      blockedOn={"Meaningful trends need several months of uploads. The first upload establishes the baseline only."}
    />
  );
}
