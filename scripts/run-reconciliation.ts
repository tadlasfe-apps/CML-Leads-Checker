import { runReconciliation } from "../src/lib/reconciliation";

async function main() {
  console.log("Running reconciliation engine...");
  const result = await runReconciliation();
  console.log(`Results: totalLeads=${result.totalLeads}, duplicatesMarked=${result.duplicatesMarked}, appointmentBasedFlagged=${result.appointmentBasedFlagged}`);
}

main().catch(console.error);
