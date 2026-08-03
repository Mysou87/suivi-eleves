@echo off
rem Lance le panneau d'administration sur cet ordinateur.
rem L'administration ne fonctionne QUE d'ici : le mot de passe n'est pas publie
rem en ligne, c'est ce qui empeche n'importe qui d'y acceder.

cd /d "%~dp0"
title Administration du suivi des eleves

echo.
echo   Demarrage du panneau d'administration...
echo   Le navigateur va s'ouvrir tout seul.
echo.
echo   Laisse cette fenetre ouverte pendant que tu travailles.
echo   Ferme-la (ou Ctrl+C) quand tu as fini.
echo.

rem On attend 2 secondes que le serveur reponde avant d'ouvrir le navigateur.
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://localhost:4173/admin.html"

node tools\serve.mjs

echo.
echo   Serveur arrete.
pause
