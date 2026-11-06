const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'app', '(app)', 'payments', 'PaymentsHubClient.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the old modal (lines 533-600) with the new modal that includes:
// - Walk-in guard: eligibleCustomers
// - Invoice suggestions
// - Customer credit fallback message
const oldModal = content.slice(
  content.indexOf('          {/* Modal / Dialog for Recording Payment from Line */}'),
  content.indexOf('          {/* Modal / Dialog for Recording Payment from Line */}') +
    content.slice(content.indexOf('          {/* Modal / Dialog for Recording Payment from Line */}')).indexOf('        </div>\n      )}\n\n      {/* \u2500\u2500 4. Cheques') + '        </div>\n      )}'.length
);

const newModal = `          {/* Modal / Dialog for Recording Payment from Line */}
          {selectedLine && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <Card className="w-full max-w-lg border-ace-band bg-white">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-ace-navy">Record Payment from Statement Line</CardTitle>
                  <CardDescription className="text-xs text-ace-muted">
                    Atomically creates confirmed payment and matches line. Matched only once.
                    Requires payments:record AND statements:match.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div className="rounded bg-ace-band/40 p-3 space-y-1">
                    <div><span className="font-semibold">Line Amount:</span> {fmtMWK(selectedLine.amountMinor)}</div>
                    <div><span className="font-semibold">Reference:</span> {selectedLine.reference || '\u2014'}</div>
                    <div><span className="font-semibold">Date:</span> {selectedLine.transactionDate}</div>
                    <div><span className="font-semibold">Description:</span> {selectedLine.description || '\u2014'}</div>
                  </div>
                  <div>
                    <label className="block font-medium text-ace-navy mb-1">Customer (walk-in not allowed)</label>
                    <select
                      value={selectedCustomer}
                      onChange={(e) => { setSelectedCustomer(e.target.value); setSelectedInvoiceId(''); }}
                      className="w-full rounded border border-ace-band p-2 text-xs"
                    >
                      {eligibleCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.accountNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-ace-navy mb-1">Location</label>
                    <select
                      value={selectedLocation}
                      onChange={(e) => setSelectedLocation(e.target.value)}
                      className="w-full rounded border border-ace-band p-2 text-xs"
                    >
                      {locationsList.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-ace-navy mb-1">
                      Apply to Invoice (optional \u2014 leave blank to credit customer account)
                    </label>
                    <select
                      value={selectedInvoiceId}
                      onChange={(e) => setSelectedInvoiceId(e.target.value)}
                      className="w-full rounded border border-ace-band p-2 text-xs"
                    >
                      <option value="">\u2014 No invoice: credit customer account \u2014</option>
                      {lineSuggestions.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} \u00b7 {inv.customerName} \u00b7 Balance: {fmtMWK(inv.balanceMinor)}
                        </option>
                      ))}
                    </select>
                    {!selectedInvoiceId && (
                      <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-amber-700 text-xs">
                        No invoice selected \u2014 payment will be credited to the customer account.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSelectedLine(null); setSelectedInvoiceId(''); }}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRecordFromLine}
                      disabled={isPending}
                    >
                      {selectedInvoiceId ? 'Record & Apply to Invoice' : 'Record as Customer Credit'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}`;

// Find start marker
const startMarker = '          {/* Modal / Dialog for Recording Payment from Line */}';
const endMarker = '        </div>\n      )}\n\n      {/* \u2500\u2500 4. Cheques';
const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found', { startIdx, endIdx });
  process.exit(1);
}

const before = content.slice(0, startIdx);
const after = content.slice(endIdx);
const newContent = before + newModal + '\n\n      ' + after.slice(8); // skip the 8-space indent from endMarker

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Modal section updated successfully.');

