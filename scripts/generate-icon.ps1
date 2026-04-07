Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$pngPath = Join-Path $buildDir 'icon.png'
$icoPath = Join-Path $buildDir 'icon.ico'

$size = 256
$bitmap = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-HexPath([float]$cx, [float]$cy, [float]$w, [float]$h) {
    $halfW = $w / 2
    $halfH = $h / 2
    $inset = $w * 0.22
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($cx - $halfW + $inset, $cy - $halfH),
        [System.Drawing.PointF]::new($cx + $halfW - $inset, $cy - $halfH),
        [System.Drawing.PointF]::new($cx + $halfW, $cy),
        [System.Drawing.PointF]::new($cx + $halfW - $inset, $cy + $halfH),
        [System.Drawing.PointF]::new($cx - $halfW + $inset, $cy + $halfH),
        [System.Drawing.PointF]::new($cx - $halfW, $cy)
    )
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddPolygon($points)
    return $path
}

$outer = New-RoundedRectPath 10 10 236 236 54
$graphics.FillPath(
    (New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
        [System.Drawing.Point]::new(0, 0),
        [System.Drawing.Point]::new($size, $size),
        ([System.Drawing.Color]::FromArgb(255, 7, 16, 29)),
        ([System.Drawing.Color]::FromArgb(255, 23, 95, 104))
    )),
    $outer
)

$innerGlow = New-Object System.Drawing.Drawing2D.GraphicsPath
$innerGlow.AddEllipse(20, 18, 216, 186)
$glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($innerGlow)
$glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(86, 70, 145, 200)
$glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 70, 145, 200))
$graphics.FillEllipse($glowBrush, 20, 18, 216, 186)

$framePath = New-HexPath 126 122 156 132
$frameShadow = New-HexPath 130 126 156 132
$graphics.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(50, 0, 0, 0))), $frameShadow)
$frameBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
    [System.Drawing.Point]::new(52, 54),
    [System.Drawing.Point]::new(202, 190),
    ([System.Drawing.Color]::FromArgb(255, 17, 34, 53)),
    ([System.Drawing.Color]::FromArgb(255, 42, 101, 122))
)
$graphics.FillPath($frameBrush, $framePath)
$graphics.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 136, 184, 206)), 3), $framePath)

$corePath = New-HexPath 124 118 128 104
$coreBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
    [System.Drawing.Point]::new(70, 68),
    [System.Drawing.Point]::new(184, 170),
    ([System.Drawing.Color]::FromArgb(255, 236, 244, 245)),
    ([System.Drawing.Color]::FromArgb(255, 178, 202, 208))
)
$graphics.FillPath($coreBrush, $corePath)
$graphics.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 255, 255, 255))), (New-HexPath 110 98 66 36))

$controllerShadow = New-Object System.Drawing.Drawing2D.GraphicsPath
$controllerShadow.AddArc(54, 106, 68, 72, 145, 168)
$controllerShadow.AddArc(134, 106, 68, 72, 227, 168)
$controllerShadow.AddArc(139, 100, 40, 32, 320, 110)
$controllerShadow.AddArc(77, 82, 104, 54, 180, 180)
$controllerShadow.AddArc(79, 102, 42, 32, 110, 110)
$controllerShadow.CloseFigure()
$graphics.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))), $controllerShadow)

$controllerPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$controllerPath.AddArc(50, 100, 72, 78, 145, 170)
$controllerPath.AddArc(134, 100, 72, 78, 225, 170)
$controllerPath.AddArc(141, 96, 42, 34, 322, 110)
$controllerPath.AddArc(73, 74, 112, 58, 180, 180)
$controllerPath.AddArc(81, 98, 42, 34, 108, 112)
$controllerPath.CloseFigure()
$controllerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @(
    [System.Drawing.Point]::new(64, 82),
    [System.Drawing.Point]::new(194, 176),
    ([System.Drawing.Color]::FromArgb(255, 16, 29, 49)),
    ([System.Drawing.Color]::FromArgb(255, 32, 67, 90))
)
$graphics.FillPath($controllerBrush, $controllerPath)
$graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 255, 255, 255))), 78, 86, 102, 22)

$accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 86, 209, 214))
$goldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 246, 198, 103))
$darkAccentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 79, 107))
$eyeWhiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 249, 248))
$eyePupilBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 18, 31, 45))
$arrowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 248, 242))
$scaleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 117, 229, 214))

$graphics.FillRectangle($goldBrush, 89, 126, 24, 7)
$graphics.FillRectangle($goldBrush, 98, 117, 7, 25)
$graphics.FillEllipse($accentBrush, 145, 121, 11, 11)
$graphics.FillEllipse($accentBrush, 161, 133, 11, 11)
$graphics.FillEllipse($accentBrush, 145, 145, 11, 11)
$graphics.FillEllipse($accentBrush, 129, 133, 11, 11)
$graphics.FillEllipse($darkAccentBrush, 96, 147, 17, 17)
$graphics.FillEllipse($darkAccentBrush, 142, 156, 17, 17)

$graphics.FillEllipse($eyeWhiteBrush, 101, 103, 22, 18)
$graphics.FillEllipse($eyeWhiteBrush, 133, 103, 22, 18)
$graphics.FillEllipse($eyePupilBrush, 109, 108, 8, 8)
$graphics.FillEllipse($eyePupilBrush, 141, 108, 8, 8)

$orbBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush((New-HexPath 126 120 92 74))
$orbBrush.CenterColor = [System.Drawing.Color]::FromArgb(64, 255, 255, 255)
$orbBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$graphics.FillEllipse($orbBrush, 72, 80, 108, 80)

$topMarkPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 246, 198, 103)), 5
$topMarkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$topMarkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($topMarkPen, 106, 60, 126, 44)
$graphics.DrawLine($topMarkPen, 126, 44, 148, 60)
$graphics.DrawLine($topMarkPen, 111, 70, 126, 58)
$graphics.DrawLine($topMarkPen, 126, 58, 141, 70)

$scaleRects = @(
    @(158, 60, 12, 12),
    @(174, 49, 16, 16),
    @(194, 35, 21, 21)
)
foreach ($rect in $scaleRects) {
    $graphics.FillRectangle($scaleBrush, $rect[0], $rect[1], $rect[2], $rect[3])
}

$arrowPoints = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(161, 87),
    [System.Drawing.PointF]::new(161, 75),
    [System.Drawing.PointF]::new(190, 75),
    [System.Drawing.PointF]::new(190, 62),
    [System.Drawing.PointF]::new(215, 84),
    [System.Drawing.PointF]::new(190, 106),
    [System.Drawing.PointF]::new(190, 93),
    [System.Drawing.PointF]::new(170, 93)
)
$graphics.FillPolygon($arrowBrush, $arrowPoints)

$badgeGlow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(54, 195, 255, 215))
$badgeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 248, 242))
$graphics.FillEllipse($badgeGlow, 174, 170, 50, 50)
$graphics.FillEllipse($badgeBrush, 179, 175, 40, 40)
$checkPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 19, 146, 116)), 7
$checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($checkPen, 189, 195, 197, 203)
$graphics.DrawLine($checkPen, 197, 203, 210, 188)

$starPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, 245, 250, 255)), 4
$graphics.DrawLine($starPen, 54, 54, 54, 68)
$graphics.DrawLine($starPen, 47, 61, 61, 61)
$graphics.DrawLine($starPen, 198, 54, 198, 66)
$graphics.DrawLine($starPen, 192, 60, 204, 60)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$iconHandle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$fileStream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fileStream)
$fileStream.Close()

$icon.Dispose()
[System.Runtime.InteropServices.Marshal]::Release($iconHandle) | Out-Null

$starPen.Dispose()
$checkPen.Dispose()
$badgeBrush.Dispose()
$badgeGlow.Dispose()
$arrowBrush.Dispose()
$scaleBrush.Dispose()
$eyePupilBrush.Dispose()
$eyeWhiteBrush.Dispose()
$topMarkPen.Dispose()
$orbBrush.Dispose()
$darkAccentBrush.Dispose()
$goldBrush.Dispose()
$accentBrush.Dispose()
$controllerBrush.Dispose()
$controllerShadow.Dispose()
$controllerPath.Dispose()
$coreBrush.Dispose()
$corePath.Dispose()
$frameBrush.Dispose()
$frameShadow.Dispose()
$framePath.Dispose()
$glowBrush.Dispose()
$innerGlow.Dispose()
$outer.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
