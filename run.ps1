do{
    $ts = Get-Date -Format "yyyy-MM-dd-HH.mm"
    $PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
    Invoke-Expression "env `$(cat .env.production | grep -v '#') npx ts-node --files src/index.ts >> .\log\$($ts).log"
    Start-Sleep -Milliseconds 500
} while($true)