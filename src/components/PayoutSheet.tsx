import { formatCount, formatINR } from "@shared/money";
import { formatFullDate, formatWeekRange } from "@shared/dates";
import type { WeekResult } from "@shared/types";

/**
 * The printed payout sheet.
 *
 * Screen-hidden, print-only. Deliberately plain: a header, one block per
 * worker showing how the wage was made up and every adjustment applied, a
 * grand total, and a signature column — the thing you keep in a file.
 */
export function PayoutSheet({
  week,
  businessName,
}: {
  week: WeekResult;
  businessName: string;
}) {
  const printedOn = formatFullDate(new Date().toISOString().slice(0, 10));

  return (
    <div className="print-only" aria-hidden>
      <header
        style={{
          borderBottom: "2px solid #000",
          paddingBottom: "6pt",
          marginBottom: "10pt",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontSize: "15pt", fontWeight: 700, margin: 0 }}>{businessName}</h1>
          <span style={{ fontSize: "9pt" }}>Printed {printedOn}</span>
        </div>
        <p style={{ margin: "3pt 0 0", fontSize: "11pt" }}>
          Wage sheet — week of {formatWeekRange(week.weekStart)} (Sunday to Saturday)
          {week.status === "finalized" && " · FINALIZED"}
        </p>
      </header>

      {week.workers.map((worker) => (
        <section className="print-block" key={worker.workerId} style={{ marginBottom: "12pt" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              borderBottom: "1px solid #000",
              paddingBottom: "2pt",
              marginBottom: "4pt",
            }}
          >
            <h2 style={{ fontSize: "12pt", fontWeight: 700, margin: 0 }}>
              {worker.workerName}
            </h2>
            <span style={{ fontSize: "13pt", fontWeight: 700 }}>
              {formatINR(worker.netPayable)}
            </span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9.5pt" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "1pt 0", fontWeight: 600, width: "40%" }}>Item</th>
                <th style={{ padding: "1pt 0", fontWeight: 600, textAlign: "right" }}>
                  Quantity
                </th>
                <th style={{ padding: "1pt 0", fontWeight: 600, textAlign: "right" }}>Rate</th>
                <th style={{ padding: "1pt 0", fontWeight: 600, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {worker.lineItems
                .filter((item) => item.wage !== 0 || item.totalQuantity !== 0)
                .map((item) => (
                  <tr key={item.workTypeId}>
                    <td style={{ padding: "1pt 0" }}>
                      {item.name}
                      {item.looms > 1 && (
                        <span style={{ fontSize: "8pt", color: "#555" }}>
                          {" "}
                          ({item.loomTotals.map((t, i) => `L${i + 1} ${formatCount(t)}`).join(", ")})
                        </span>
                      )}
                      {item.rateVaried && (
                        <span style={{ fontSize: "8pt", color: "#555" }}> (rate changed)</span>
                      )}
                    </td>
                    <td style={{ padding: "1pt 0", textAlign: "right" }}>
                      {item.kind === "direct_sum"
                        ? `${item.daysWorked} days`
                        : formatCount(item.totalQuantity)}
                    </td>
                    <td style={{ padding: "1pt 0", textAlign: "right" }}>
                      {item.kind === "count_x_price" && !item.rateVaried
                        ? formatINR(item.unitPrice)
                        : item.kind === "formula_sum_ratio"
                          ? `÷${formatCount(item.divisor)} × ${formatINR(item.multiplier)}`
                          : "—"}
                    </td>
                    <td style={{ padding: "1pt 0", textAlign: "right" }}>
                      {formatINR(item.wage)}
                    </td>
                  </tr>
                ))}

              <tr style={{ borderTop: "1px solid #999" }}>
                <td colSpan={3} style={{ padding: "2pt 0", fontWeight: 600 }}>
                  Wage
                </td>
                <td style={{ padding: "2pt 0", textAlign: "right", fontWeight: 600 }}>
                  {formatINR(worker.wage)}
                </td>
              </tr>

              {worker.advances.length > 0 &&
                worker.advances.map((advance) => (
                  <tr key={advance.id}>
                    <td colSpan={3} style={{ padding: "1pt 0", color: "#333" }}>
                      {advance.kind === "advance" ? "Advance given" : "Advance returned"} on{" "}
                      {formatFullDate(advance.entryDate)}
                      {advance.note ? ` — ${advance.note}` : ""}
                    </td>
                    <td style={{ padding: "1pt 0", textAlign: "right", color: "#333" }}>
                      {advance.kind === "advance" ? "−" : "+"}
                      {formatINR(advance.amount)}
                    </td>
                  </tr>
                ))}

              {adjustmentRows(worker).map((row) => (
                <tr key={row.label}>
                  <td colSpan={3} style={{ padding: "1pt 0" }}>
                    {row.label}
                  </td>
                  <td style={{ padding: "1pt 0", textAlign: "right" }}>{row.value}</td>
                </tr>
              ))}

              <tr style={{ borderTop: "2px solid #000" }}>
                <td colSpan={3} style={{ padding: "3pt 0", fontWeight: 700 }}>
                  Net paid
                </td>
                <td style={{ padding: "3pt 0", textAlign: "right", fontWeight: 700 }}>
                  {formatINR(worker.netPayable)}
                </td>
              </tr>
            </tbody>
          </table>

          {(worker.closingBalance.creditOutstanding > 0 ||
            worker.closingBalance.debitOutstanding > 0 ||
            worker.closingBalance.advanceOutstanding > 0) && (
            <p style={{ margin: "3pt 0 0", fontSize: "8.5pt", color: "#333" }}>
              Carried forward:
              {worker.closingBalance.advanceOutstanding > 0 &&
                ` advance ${formatINR(worker.closingBalance.advanceOutstanding)} owed to you;`}
              {worker.closingBalance.creditOutstanding > 0 &&
                ` credit ${formatINR(worker.closingBalance.creditOutstanding)} owed to you;`}
              {worker.closingBalance.debitOutstanding > 0 &&
                ` ${formatINR(worker.closingBalance.debitOutstanding)} owed to worker;`}
            </p>
          )}

          <div style={{ marginTop: "8pt", fontSize: "9pt" }}>
            Received by: ______________________________ &nbsp;&nbsp; Date: ______________
          </div>
        </section>
      ))}

      <footer style={{ borderTop: "2px solid #000", paddingTop: "5pt", marginTop: "6pt" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
          <tbody>
            <tr>
              <td style={{ padding: "1pt 0" }}>Total wages earned</td>
              <td style={{ padding: "1pt 0", textAlign: "right" }}>
                {formatINR(week.totals.wage)}
              </td>
            </tr>
            {week.totals.advanceRecovered > 0 && (
              <tr>
                <td style={{ padding: "1pt 0" }}>Advances recovered</td>
                <td style={{ padding: "1pt 0", textAlign: "right" }}>
                  −{formatINR(week.totals.advanceRecovered)}
                </td>
              </tr>
            )}
            <tr style={{ borderTop: "1px solid #000" }}>
              <td style={{ padding: "3pt 0", fontWeight: 700, fontSize: "12pt" }}>
                Total paid out ({week.workers.length} workers)
              </td>
              <td
                style={{
                  padding: "3pt 0",
                  textAlign: "right",
                  fontWeight: 700,
                  fontSize: "12pt",
                }}
              >
                {formatINR(week.totals.netPayable)}
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ margin: "4pt 0 0", fontSize: "8pt", color: "#555" }}>
          {formatCount(week.totals.quantity)} pieces processed. Rates shown are those in force
          when each day was recorded.
        </p>
      </footer>
    </div>
  );
}

function adjustmentRows(worker: WeekResult["workers"][number]) {
  const rows: Array<{ label: string; value: string }> = [];
  const { adjustments: a } = worker;
  if (a.advanceRecovered > 0)
    rows.push({
      label: "Less: advance recovered",
      value: `−${formatINR(a.advanceRecovered)}`,
    });
  if (a.deduct > 0)
    rows.push({ label: "Less: earlier credit recovered", value: `−${formatINR(a.deduct)}` });
  if (a.addback > 0)
    rows.push({ label: "Plus: earlier balance repaid", value: `+${formatINR(a.addback)}` });
  if (a.credit > 0)
    rows.push({ label: "Plus: rounded up (credit)", value: `+${formatINR(a.credit)}` });
  if (a.debit > 0)
    rows.push({ label: "Less: rounded down (held)", value: `−${formatINR(a.debit)}` });
  return rows;
}
