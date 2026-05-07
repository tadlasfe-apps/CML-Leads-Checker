import { runReconciliation } from "../src/lib/reconciliation";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Running reconciliation engine...");
  const result = await runReconciliation();
  console.log(`Results: matched=${result.matched}, possible=${result.possible}, unmatched=${result.unmatched}`);

  const forms = await prisma.wordPressFormSummary.findMany({ orderBy: { totalSubmissions: "desc" } });
  console.log(`\nWordPress Form Summaries (${forms.length} forms):`);
  for (const f of forms) {
    console.log(`  ${f.formName}: ${f.totalSubmissions} total, ${f.uniqueLeads} unique, ${f.ghlMatchedCount} GHL matched (${f.formToGhlReconciliationRate.toFixed(1)}%) — ${f.reconciliationStatus}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
