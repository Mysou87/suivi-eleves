@echo off
rem Lance le panneau d'administration sur cet ordinateur.
rem L'administration ne fonctionne QUE d'ici : ni le mot de passe ni la cle
rem d'ecriture ne sont publies en ligne, c'est ce qui empeche n'importe qui d'y
rem acceder.

cd /d "%~dp0"
title Administration du suivi des eleves

rem --- Node.js est-il installe ?
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe sur cet ordinateur.
  echo   Telecharge-le ici, version LTS : https://nodejs.org
  echo   Puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

rem --- Les dependances sont-elles la ? (premier lancement sur un poste neuf)
if not exist "node_modules\xlsx" (
  echo.
  echo   Premiere utilisation sur cet ordinateur : installation des dependances.
  echo   Une minute environ, une seule fois.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   L'installation a echoue. Verifie ta connexion internet.
    echo.
    pause
    exit /b 1
  )
)

rem --- La cle d'ecriture est-elle configuree ?
if not exist "js\config.local.js" (
  echo.
  echo   Il manque le fichier js\config.local.js, qui contient le mot de passe
  echo   et la cle d'ecriture de la base. Il n'est jamais publie, il faut donc
  echo   le creer sur chaque ordinateur. Voir la section "Installer sur un
  echo   second ordinateur" du README.
  echo.
  pause
  exit /b 1
)

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
