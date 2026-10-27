'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  previewProductsCsvAction,
  commitProductsCsvAction,
  previewOpeningStockCsvAction,
  commitOpeningStockCsvAction,
} from './actions';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Download,
  Layers,
  Package,
} from 'lucide-react';

export function ImportClient() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'products' | 'opening'>('products');
  const [isPending, startTransition] = useTransition();

  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [previewResult, setPreviewResult] = useState<any | null>(null);

  const resetState = () => {
    setCsvContent('');
    setFileName('');
    setPreviewResult(null);
  };

  const handleTabChange = (tab: 'products' | 'opening') => {
    setActiveTab(tab);
    resetState();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvContent(content);
      handlePreview(content);
    };
    reader.readAsText(file);
  };

  const handlePreview = (content: string) => {
    startTransition(async () => {
      try {
        if (activeTab === 'products') {
          const res = await previewProductsCsvAction(content);
          setPreviewResult(res);
          if (res.errorCount === 0) {
            toast.success(`Validated ${res.validCount} products successfully! Ready to import.`);
          } else {
            toast.warning(`Found ${res.errorCount} row(s) with errors. Fix before importing.`);
          }
        } else {
          const res = await previewOpeningStockCsvAction(content);
          setPreviewResult(res);
          if (res.errorCount === 0) {
            toast.success(`Validated ${res.validCount} opening lines! Ready to import.`);
          } else {
            toast.warning(`Found ${res.errorCount} row(s) with errors. Fix before importing.`);
          }
        }
      } catch (err: any) {
        toast.error(err.message || 'CSV parse error');
      }
    });
  };

  const handleCommit = () => {
    if (!previewResult || previewResult.errorCount > 0) {
      toast.error('Cannot import until all errors are resolved.');
      return;
    }

    startTransition(async () => {
      try {
        if (activeTab === 'products') {
          const res = await commitProductsCsvAction(csvContent);
          if (res.success) {
            toast.success(`Successfully imported ${res.result.importedCount} products!`);
            router.push('/stock/products');
          }
        } else {
          const res = await commitOpeningStockCsvAction(csvContent);
          if (res.success) {
            toast.success(`Successfully recorded ${res.result.importedCount} opening stock lines!`);
            router.push('/stock/on-hand');
          }
        }
      } catch (err: any) {
        toast.error(err.message || 'Import transaction failed.');
      }
    });
  };

  const downloadProductTemplate = () => {
    const csv = `name,sku,barcode,description,category_code,uom_code,product_type,selling_price_mwk,min_stock_alert,max_stock,serial_tracking,warranty_months\n"Dell Latitude 5540","DELL-5540","8901234567","15.6 inch Core i7","COMP","PCS","standard","1450000","5","30","true","12"\n"Logitech Wireless Mouse","LOGI-M185","8901234568","Wireless optical mouse","ACC","PCS","standard","18500","10","50","false","6"`;
    downloadBlob(csv, 'products_template.csv');
  };

  const downloadOpeningTemplate = () => {
    const csv = `sku,location_code,quantity,unit_cost_mwk,serial_numbers\n"DELL-5540","MAIN-WH","2","1100000","SN-DELL-001,SN-DELL-002"\n"LOGI-M185","MAIN-WH","15","12500",""`;
    downloadBlob(csv, 'opening_stock_template.csv');
  };

  const downloadBlob = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => handleTabChange('products')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'products'
              ? 'border-ace-blue text-ace-blue'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package className="h-4 w-4" />
          Import Products Catalog
        </button>
        <button
          onClick={() => handleTabChange('opening')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'opening'
              ? 'border-ace-blue text-ace-blue'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Layers className="h-4 w-4" />
          Import Opening Stock
        </button>
      </div>

      {/* Upload & Instructions Card */}
      <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ace-navy">
              {activeTab === 'products'
                ? 'Bulk Products CSV Upload'
                : 'Opening Stock Inventory Upload'}
            </h2>
            <p className="text-xs text-ace-muted">
              {activeTab === 'products'
                ? 'Import SKU, name, price, categories, and serial tracking rules in a single batch.'
                : 'Establish baseline on-hand quantities and costs. Enforces single-opening rule per location.'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={
              activeTab === 'products' ? downloadProductTemplate : downloadOpeningTemplate
            }
          >
            <Download className="h-4 w-4 mr-1.5" />
            Download Sample CSV
          </Button>
        </div>

        {/* Drag and Drop Zone */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-ace-blue transition-colors bg-gray-50/50">
          <UploadCloud className="h-10 w-10 text-ace-blue mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700 mb-1">
            {fileName ? (
              <span className="font-semibold text-ace-navy">{fileName}</span>
            ) : (
              'Choose a CSV file or drag and drop here'
            )}
          </p>
          <p className="text-xs text-gray-500 mb-4">UTF-8 encoded .csv files only</p>
          <label className="cursor-pointer">
            <span className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
              Browse Files
            </span>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Validation Preview Card */}
      {previewResult && (
        <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-ace-navy">Dry-Run Validation</h3>
              <Badge variant="outline" className="text-xs">
                Total Rows: {previewResult.totalRows}
              </Badge>
              <Badge
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700 text-xs"
              >
                ✓ {previewResult.validCount} Valid
              </Badge>
              {previewResult.errorCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  ✕ {previewResult.errorCount} Errors
                </Badge>
              )}
            </div>

            <Button
              onClick={handleCommit}
              disabled={isPending || previewResult.errorCount > 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {isPending
                ? 'Importing Database...'
                : `Commit ${previewResult.validCount} Row(s)`}
            </Button>
          </div>

          {previewResult.errorCount > 0 && (
            <div className="rounded-md bg-red-50 p-3 border border-red-200 text-sm text-red-800 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">All-or-Nothing Rule:</span>
                Import cannot proceed while errors exist. Please review the errors in the table below, correct your CSV, and re-upload.
              </div>
            </div>
          )}

          {/* Preview Table */}
          <div className="overflow-x-auto max-h-96 border rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-gray-100 sticky top-0 font-semibold text-gray-700">
                <tr className="border-b">
                  <th className="py-2 px-3 w-16">Row #</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 font-mono">
                    {activeTab === 'products' ? 'SKU / Name' : 'SKU / Location'}
                  </th>
                  <th className="py-2 px-3">Details</th>
                  <th className="py-2 px-3">Errors / Messages</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono">
                {previewResult.rows.map((row: any) => (
                  <tr
                    key={row.rowNumber}
                    className={row.isValid ? 'hover:bg-gray-50' : 'bg-red-50/50'}
                  >
                    <td className="py-2 px-3 font-semibold text-gray-600">
                      {row.rowNumber}
                    </td>
                    <td className="py-2 px-3">
                      {row.isValid ? (
                        <span className="text-emerald-700 font-semibold">Valid</span>
                      ) : (
                        <span className="text-red-600 font-semibold">Error</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {activeTab === 'products' ? (
                        <div>
                          <span className="font-bold text-ace-navy">{row.data.sku}</span>
                          <span className="block text-gray-600 font-sans">
                            {row.data.name}
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="font-bold text-ace-navy">{row.data.sku}</span>
                          <span className="block text-gray-600 font-sans">
                            {row.locationName || row.data.location_code}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 font-sans">
                      {activeTab === 'products' ? (
                        <span>
                          Price: MWK {row.data.selling_price_mwk} | UOM: {row.data.uom_code}
                          {row.data.serial_tracking === 'true' && ' [Serials]'}
                        </span>
                      ) : (
                        <span>
                          Qty: {row.data.quantity} @ MWK {row.data.unit_cost_mwk}
                          {row.serialsList?.length > 0 &&
                            ` (${row.serialsList.length} serials)`}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-sans text-red-600">
                      {row.errors.length > 0 ? (
                        <ul className="list-disc pl-4 space-y-0.5">
                          {row.errors.map((err: string, i: number) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-emerald-600 text-xs">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
