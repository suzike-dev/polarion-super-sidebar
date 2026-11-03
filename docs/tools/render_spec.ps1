$ErrorActionPreference = 'Stop'
$documentRoot = Split-Path -Parent $PSScriptRoot
$documentPath = Join-Path $documentRoot 'Polarion超级侧边栏_功能规格_v0.1.docx'
$pdfPath = Join-Path $documentRoot 'Polarion超级侧边栏_功能规格_v0.1.pdf'
$wordApplication = $null
$wordDocument = $null
try {
    $wordApplication = New-Object -ComObject Word.Application
    $wordApplication.Visible = $false
    $wordApplication.DisplayAlerts = 0
    $wordDocument = $wordApplication.Documents.Open($documentPath, $false, $false)
    foreach ($toc in $wordDocument.TablesOfContents) { $toc.Update() }
    $wordDocument.Fields.Update() | Out-Null
    $wordDocument.Repaginate()
    foreach ($toc in $wordDocument.TablesOfContents) { $toc.UpdatePageNumbers() }
    $wordDocument.Save()
    $wordDocument.ExportAsFixedFormat($pdfPath, 17)
    [pscustomobject]@{
        Document = $documentPath
        Pdf = $pdfPath
        Pages = $wordDocument.ComputeStatistics(2)
        TablesOfContents = $wordDocument.TablesOfContents.Count
    } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $wordDocument) {
        $wordDocument.Close(0)
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordDocument) | Out-Null
    }
    if ($null -ne $wordApplication) {
        $wordApplication.Quit()
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApplication) | Out-Null
    }
}
