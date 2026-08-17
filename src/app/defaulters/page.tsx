import { Planned } from "@/components/Planned";

export default function Page() {
  return (
    <Planned
      purpose={"Show the tenants who fail to pay month after month, so they can be dealt with differently from someone who is late once."}
      contents={[
              "Tenants ranked by how many months in a row their payment has failed.",
              "How many late fees each one has been charged.",
              "Whether their balance is getting better or worse over time.",
              "This is also the starting point for the prediction work planned for a later phase."
      ]}
      blockedOn={"Patterns need several months of uploads before they mean anything. The first upload only sets the starting point."}
    />
  );
}
