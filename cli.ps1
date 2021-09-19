$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
Invoke-Expression "env `$(cat .env.production | grep -v '#') npx ts-node --files src/ui/main.ts"