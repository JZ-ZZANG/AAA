!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var AiRuntimeCheckbox
  Var AiRuntimeRequested

  !macro customPageAfterChangeDir
    Page custom AiRuntimePageCreate AiRuntimePageLeave
  !macroend

  Function AiRuntimePageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 28u "AI 검열 기능을 함께 설치할 수 있습니다."
    Pop $0
    ${NSD_CreateCheckbox} 0 38u 100% 18u "AI 검열 기능 설치"
    Pop $AiRuntimeCheckbox
    ${NSD_SetState} $AiRuntimeCheckbox ${BST_UNCHECKED}
    nsDialogs::Show
  FunctionEnd

  Function AiRuntimePageLeave
    ${NSD_GetState} $AiRuntimeCheckbox $AiRuntimeRequested
  FunctionEnd

  !macro customInstall
    ${If} $AiRuntimeRequested == ${BST_CHECKED}
      CreateDirectory "$APPDATA\JZ-ZZANG\AAA"
      FileOpen $0 "$APPDATA\JZ-ZZANG\AAA\install-ai-runtime-requested" w
      FileWrite $0 "1"
      FileClose $0
    ${EndIf}
  !macroend
!endif
