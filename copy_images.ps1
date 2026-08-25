$src = "c:\Users\DELL\Desktop\zoro finds clips\images"
$dst = "c:\Users\DELL\Desktop\zoro finds clips\dist\images"
Copy-Item "$src\*" "$dst\" -Force
$count = (Get-ChildItem "$dst" -File).Count
Write-Host "Done. Copied $count image files to dist/images."
