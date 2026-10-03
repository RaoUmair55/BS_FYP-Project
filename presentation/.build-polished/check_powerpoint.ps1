$ErrorActionPreference = 'Stop'
$deckPath = 'D:\BS_FYP Project\IntegrityFlow\presentation\output\IntegrityFlow_Panel_Animated_2026.pptx'
$previewPath = 'D:\BS_FYP Project\IntegrityFlow\presentation\.build-polished\powerpoint-previews'
$reportPath = 'D:\BS_FYP Project\IntegrityFlow\presentation\.build-polished\powerpoint-check.json'
$powerPoint = New-Object -ComObject PowerPoint.Application
$openedDeck = $null
try {
    $openedDeck = $powerPoint.Presentations.Open($deckPath, -1, 0, 0)
    $slides = @()
    foreach ($slide in $openedDeck.Slides) {
        $slides += [pscustomobject]@{
            Number = $slide.SlideIndex
            Shapes = $slide.Shapes.Count
            NativeAnimationEffects = $slide.TimeLine.MainSequence.Count
            AdvanceOnClick = $slide.SlideShowTransition.AdvanceOnClick
        }
    }
    $openedDeck.Export($previewPath, 'PNG', 1280, 720)
    [pscustomobject]@{
        Application = 'Microsoft PowerPoint'
        Version = $powerPoint.Version
        SlideCount = $openedDeck.Slides.Count
        Slides = $slides
        RenderedPath = $previewPath
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Output "PowerPoint opened and rendered $($openedDeck.Slides.Count) slides"
} finally {
    if ($null -ne $openedDeck) { $openedDeck.Close() }
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
}
