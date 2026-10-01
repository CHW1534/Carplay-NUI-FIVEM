local isOpen = false
local isTyping = false
local wasInVehicle = false
local activeVehicles = {}
local maxAudioDistance = 45.0
local lastRadioStation = nil
local serverTimeDelta = 0
local party = {
    active = false,
    isHost = false,
    track = nil
}
local partyInvitePending = false

local radioStationNames = {
    ["RADIO_01_CLASS_ROCK"]            = "Los Santos Rock Radio",
    ["RADIO_02_POP"]                   = "Non-Stop-Pop FM",
    ["RADIO_03_HIPHOP"]                = "Radio Los Santos",
    ["RADIO_04_PUNK"]                  = "Channel X",
    ["RADIO_05_TALK_01"]               = "West Coast Talk Radio",
    ["RADIO_06_COUNTRY"]               = "Rebel Radio",
    ["RADIO_07_DANCE_01"]              = "Soulwax FM",
    ["RADIO_08_MEXICAN"]               = "East Los FM",
    ["RADIO_09_HIPHOP_OLD"]            = "West Coast Classics",
    ["RADIO_11_TALK_02"]               = "Blaine County Radio",
    ["RADIO_12_REGGAE"]                = "Blue Ark",
    ["RADIO_13_JAZZ"]                  = "Worldwide FM",
    ["RADIO_14_DANCE_02"]              = "FlyLo FM",
    ["RADIO_15_MOTOWN"]                = "The Lowdown 91.1",
    ["RADIO_16_SILVERLAKE"]            = "Radio Mirror Park",
    ["RADIO_17_FUNK"]                  = "Space 103.2",
    ["RADIO_18_90S_ROCK"]              = "Vinewood Boulevard Radio",
    ["RADIO_19_USER"]                  = "Self Radio",
    ["RADIO_20_THELAB"]                = "The Lab",
    ["RADIO_21_SLC"]                   = "Blonded Los Santos 97.8 FM",
    ["RADIO_22_DLC_BATTLE_MIX1_RADIO"] = "Los Santos Underground Radio",
    ["RADIO_23_DLC_XM19_RADIO"]        = "iFruit Radio",
    ["RADIO_27_DLC_PRHO_RADIO"]        = "KULT 99.1 FM",
    ["RADIO_34_DLC_HEIST4_KONG"]       = "Still Slipping Los Santos",
    ["RADIO_35_DLC_HEIST4_MLR"]        = "Music Locker Radio",
    ["RADIO_36_MOTOMAMI"]              = "MOTOMAMI Los Santos",
    ["RADIO_OFF"]                      = "Radio Apagada"
}

local function getFormattedRadioName(rawName)
    if not rawName or rawName == "RADIO_OFF" or rawName == "" then
        return nil
    end
    if radioStationNames[rawName] then
        return radioStationNames[rawName]
    end
    local gxt = GetLabelText(rawName)
    if gxt and gxt ~= "NULL" and gxt ~= "" then
        return gxt
    end
    return rawName:gsub("RADIO_", ""):gsub("_", " ")
end

local function isInVehicle()
    local ped = PlayerPedId()
    return IsPedInAnyVehicle(ped, false)
end

local function getCurrentVehicleNetId()
    local ped = PlayerPedId()
    if IsPedInAnyVehicle(ped, false) then
        local veh = GetVehiclePedIsIn(ped, false)
        if DoesEntityExist(veh) then
            return NetworkGetNetworkIdFromEntity(veh)
        end
    end
    return nil
end

local function keepCamera(changeRadio)
    local ped = PlayerPedId()
    local inVehicle = IsPedInAnyVehicle(ped, false)
    local mode = inVehicle and GetFollowVehicleCamViewMode() or GetFollowPedCamViewMode()
    changeRadio()
    CreateThread(function()
        for _ = 1, 25 do
            if inVehicle then
                SetFollowVehicleCamViewMode(mode)
            else
                SetFollowPedCamViewMode(mode)
            end
            Wait(0)
        end
    end)
end

local function applyFocus()
    if not isOpen then
        isTyping = false
        SetNuiFocus(false, false)
        SetNuiFocusKeepInput(false)
        return
    end
    SetNuiFocus(true, true)
    SetNuiFocusKeepInput(not isTyping)
end

local function setOpen(state)
    isOpen = state
    if not state then
        isTyping = false
    end
    applyFocus()
    SendNUIMessage({
        action = state and 'open' or 'close'
    })
end

RegisterCommand('carplay', function()
    if not isInVehicle() and not party.active then
        TriggerEvent('chat:addMessage', {
            args = {'CarPlay', 'Debes estar dentro de un vehículo.'}
        })
        return
    end

    local opening = not isOpen
    setOpen(opening)
    if opening and party.active and not isInVehicle() then
        SendNUIMessage({ action = 'openParty' })
    end
end, false)

RegisterKeyMapping('carplay', 'Abrir CarPlay', 'keyboard', 'F7')

RegisterNUICallback('close', function(_, cb)
    setOpen(false)
    cb({ ok = true })
end)

RegisterNUICallback('setTyping', function(data, cb)
    isTyping = isOpen and data and data.active == true
    applyFocus()
    cb({ ok = true })
end)

RegisterNUICallback('searchSongs', function(data, cb)
    cb({ ok = true })
    local query = data and data.query
    if type(query) ~= 'string' then return end
    TriggerServerEvent('carplay:server:searchSongs', query, data.reqId)
end)

RegisterNetEvent('carplay:client:searchResults', function(payload)
    SendNUIMessage({
        action = 'searchResults',
        query = payload and payload.query or '',
        reqId = payload and payload.reqId or 0,
        items = payload and payload.items or {}
    })
end)

RegisterNUICallback('getVehicle', function(_, cb)
    local ped = PlayerPedId()
    local veh = GetVehiclePedIsIn(ped, false)
    local netId = (veh ~= 0) and NetworkGetNetworkIdFromEntity(veh) or nil
    local isDriver = (veh ~= 0) and (GetPedInVehicleSeat(veh, -1) == ped) or false

    cb({
        inVehicle = isInVehicle(),
        netId = netId,
        isDriver = isDriver,
        vehicle = (veh ~= 0) and GetVehicleNumberPlateText(veh) or nil,
        modelName = (veh ~= 0) and GetLabelText(GetDisplayNameFromVehicleModel(GetEntityModel(veh))) or "Vehículo"
    })
end)

RegisterNUICallback('setRadioStation', function(data, cb)
    if party.active and not party.isHost then
        cb({ ok = false })
        return
    end

    local ped = PlayerPedId()
    if IsPedInAnyVehicle(ped, false) then
        local veh = GetVehiclePedIsIn(ped, false)
        if veh ~= 0 and GetPedInVehicleSeat(veh, -1) == ped and data and data.stationName then
            keepCamera(function()
                SetVehicleRadioEnabled(veh, true)
                SetVehRadioStation(veh, data.stationName)
                SetRadioToStationName(data.stationName)
            end)
        end
    end
    cb({ ok = true })
end)

RegisterNUICallback('syncTrackState', function(data, cb)
    if party.active and not party.isHost then
        cb({ ok = true })
        return
    end

    local ped = PlayerPedId()
    local veh = GetVehiclePedIsIn(ped, false)

    -- Only allow the DRIVER (seat -1) to modify or sync track state to the server!
    if veh ~= 0 and GetPedInVehicleSeat(veh, -1) == ped then
        local netId = NetworkGetNetworkIdFromEntity(veh)
        keepCamera(function()
            if data and data.isPlaying then
                SetVehicleRadioEnabled(veh, false)
                SetVehRadioStation(veh, 'OFF')
            else
                SetVehicleRadioEnabled(veh, true)
            end
        end)

        if netId and netId ~= 0 then
            TriggerServerEvent('carplay:server:syncVehicle', netId, data)
        end
    end
    cb({ ok = true })
end)

RegisterNetEvent('carplay:client:syncVehicle', function(netId, data)
    if data == nil then
        activeVehicles[netId] = nil
    else
        activeVehicles[netId] = data
    end
end)

RegisterNetEvent('carplay:client:initSync', function(initialState)
    activeVehicles = initialState or {}
end)

-- Receive server time for accurate sync
RegisterNetEvent('carplay:client:serverTime', function(srvTime)
    local localTime = math.floor(GetGameTimer() / 1000)
    serverTimeDelta = srvTime - localTime
end)

-- Request initial sync + server time on resource start
TriggerServerEvent('carplay:server:requestSync')
TriggerServerEvent('carplay:server:getTime')

-- Periodically sync server time (every 30 seconds)
CreateThread(function()
    while true do
        Wait(30000)
        TriggerServerEvent('carplay:server:getTime')
    end
end)

CreateThread(function()
    while true do
        Wait(500)
        local currentlyInVeh = isInVehicle()

        if currentlyInVeh ~= wasInVehicle then
            wasInVehicle = currentlyInVeh
            SendNUIMessage({
                action = 'setVehicleState',
                inVehicle = currentlyInVeh
            })
            if not currentlyInVeh then
                if isOpen then setOpen(false) end
                local ped = PlayerPedId()
                local veh = GetVehiclePedIsIn(ped, true)
                if veh ~= 0 then
                    keepCamera(function()
                        SetVehicleRadioEnabled(veh, true)
                    end)
                end
            end
        end
    end
end)

-- Driving controls & Radio scroll protection thread
CreateThread(function()
    while true do
        Wait(0)
        if isOpen then
            if isTyping then
                DisableAllControlActions(0)
                DisableAllControlActions(1)
                DisableAllControlActions(2)
            else
                EnableControlAction(0, 71, true)  -- Vehicle Accelerate
                EnableControlAction(0, 72, true)  -- Vehicle Brake
                EnableControlAction(0, 59, true)  -- Vehicle Steering LR
                EnableControlAction(0, 60, true)  -- Vehicle Steering UD
                EnableControlAction(0, 76, true)  -- Vehicle Handbrake

                DisableControlAction(0, 81, true)   -- Next Radio
                DisableControlAction(0, 82, true)   -- Prev Radio
                DisableControlAction(0, 85, true)   -- Radio Wheel (Q / Mouse)
                DisableControlAction(0, 99, true)   -- Select Next Weapon / Scroll
                DisableControlAction(0, 100, true)  -- Select Prev Weapon / Scroll
            end
        end
    end
end)

-- GTA V Radio Monitor
CreateThread(function()
    while true do
        Wait(200)
        local ped = PlayerPedId()

        if isInVehicle() then
            local radioName = GetPlayerRadioStationName() or ''
            local isRadioOn = radioName ~= '' and radioName ~= 'OFF' and radioName ~= 'RADIO_OFF'

            if isRadioOn and radioName and radioName ~= "RADIO_OFF" and radioName ~= "" then
                if radioName ~= lastRadioStation then
                    lastRadioStation = radioName
                    local formattedName = getFormattedRadioName(radioName)

                    SendNUIMessage({
                        action = 'updateGameRadio',
                        stationName = formattedName,
                        rawName = radioName,
                        isRadioOn = true
                    })
                end
            else
                if lastRadioStation ~= nil then
                    lastRadioStation = nil
                    SendNUIMessage({
                        action = 'updateGameRadio',
                        isRadioOn = false
                    })
                end
            end
        else
            if lastRadioStation ~= nil then
                lastRadioStation = nil
                SendNUIMessage({
                    action = 'updateGameRadio',
                    isRadioOn = false
                })
            end
        end
    end
end)

-- 3D Spatial Audio Attenuation & Vehicle Passenger Sync Thread
CreateThread(function()
    while true do
        Wait(100)
        local ped = PlayerPedId()
        local playerCoords = GetEntityCoords(ped)
        local myVeh = GetVehiclePedIsIn(ped, false)
        local myNetId = (myVeh ~= 0) and NetworkGetNetworkIdFromEntity(myVeh) or nil
        local isDriver = (myVeh ~= 0) and (GetPedInVehicleSeat(myVeh, -1) == ped) or false

        local closestNetId = nil
        local minDistance = maxAudioDistance
        local calculatedVolume = 0
        local closestTrackData = nil
        local isInTargetVeh = false

        -- Calculate estimated server time using local clock + delta
        local estimatedServerTime = math.floor(GetGameTimer() / 1000) + serverTimeDelta

        for netId, data in pairs(activeVehicles) do
            if data and data.isPlaying then
                local veh = nil
                if myNetId and myNetId == netId then
                    veh = myVeh
                elseif NetworkDoesEntityExistWithNetworkId(netId) then
                    veh = NetworkGetEntityFromNetworkId(netId)
                end

                if veh and veh ~= 0 and DoesEntityExist(veh) then
                    local vehCoords = GetEntityCoords(veh)
                    local dist = #(playerCoords - vehCoords)

                    if myVeh ~= 0 and myVeh == veh then
                        -- Player is inside the playing vehicle (driver or passenger)
                        closestNetId = netId
                        closestTrackData = data
                        minDistance = 0.0
                        isInTargetVeh = true
                        calculatedVolume = data.baseVolume or 70
                        SetVehicleRadioEnabled(veh, false)
                        break
                    elseif dist < minDistance then
                        minDistance = dist
                        closestNetId = netId
                        closestTrackData = data

                        local baseVol = data.baseVolume or 70
                        local factor = math.max(0.0, 1.0 - (dist / maxAudioDistance))
                        calculatedVolume = math.floor(baseVol * (factor ^ 1.8))
                    end
                end
            end
        end

        if party.active and not party.isHost and party.track and party.track.isPlaying then
            SendNUIMessage({
                action = 'partyTrack',
                track = party.track,
                estimatedServerTime = estimatedServerTime
            })
        end

        SendNUIMessage({
            action = 'setSpatialAttenuation',
            volume = calculatedVolume,
            distance = minDistance,
            netId = closestNetId,
            trackData = closestTrackData,
            isPassenger = isInTargetVeh and not isDriver,
            isDriver = isDriver,
            isInVehicle = isInTargetVeh,
            estimatedServerTime = estimatedServerTime
        })
    end
end)

local function pushPartyToNui(state)
    SendNUIMessage({
        action = 'partyState',
        party = state
    })
end

RegisterNUICallback('partyCreate', function(_, cb)
    TriggerServerEvent('carplay:server:partyCreate')
    cb({ ok = true })
end)

RegisterNUICallback('partyJoin', function(data, cb)
    TriggerServerEvent('carplay:server:partyJoin', data and data.code or '')
    cb({ ok = true })
end)

RegisterNUICallback('partyInvite', function(data, cb)
    TriggerServerEvent('carplay:server:partyInvite', data and tonumber(data.targetId) or 0)
    cb({ ok = true })
end)

RegisterNUICallback('partyRespond', function(data, cb)
    partyInvitePending = false
    TriggerServerEvent('carplay:server:partyRespond', data and data.accept == true)
    cb({ ok = true })
end)

RegisterNUICallback('partyLeave', function(_, cb)
    TriggerServerEvent('carplay:server:partyLeave')
    cb({ ok = true })
end)

RegisterNUICallback('partyKick', function(data, cb)
    TriggerServerEvent('carplay:server:partyKick', data and tonumber(data.targetId) or 0)
    cb({ ok = true })
end)

RegisterNUICallback('partyNearby', function(_, cb)
    TriggerServerEvent('carplay:server:partyNearby')
    cb({ ok = true })
end)

RegisterNUICallback('partyQueueAdd', function(data, cb)
    TriggerServerEvent('carplay:server:partyQueueAdd', data and data.items or {})
    cb({ ok = true })
end)

RegisterNUICallback('partySkip', function(data, cb)
    TriggerServerEvent('carplay:server:partySkip', data and tonumber(data.dir) or 1)
    cb({ ok = true })
end)

RegisterNUICallback('partyPlayIndex', function(data, cb)
    TriggerServerEvent('carplay:server:partyPlayIndex', data and tonumber(data.index) or 0)
    cb({ ok = true })
end)

RegisterNUICallback('partyQueueSync', function(data, cb)
    TriggerServerEvent('carplay:server:partyQueueSync', data or {})
    cb({ ok = true })
end)

RegisterNetEvent('carplay:client:partyHostControl', function(payload)
    if not party.isHost then return end
    SendNUIMessage({
        action = 'partyHostControl',
        cmd = payload and payload.cmd or '',
        items = payload and payload.items or nil,
        index = payload and payload.index or 0
    })
end)

RegisterNetEvent('carplay:client:partyQueue', function(payload)
    if party.isHost then return end
    SendNUIMessage({
        action = 'partyQueue',
        queue = payload and payload.queue or {},
        index = payload and payload.index or -1
    })
end)

RegisterNetEvent('carplay:client:partyState', function(state)
    if state then
        party.active = true
        party.isHost = state.isHost == true
    else
        party.active = false
        party.isHost = false
        party.track = nil
    end
    pushPartyToNui(state)
end)

RegisterNetEvent('carplay:client:partyTrack', function(track)
    party.track = track
    if party.active and not party.isHost then
        SendNUIMessage({
            action = 'partyTrack',
            track = track,
            estimatedServerTime = math.floor(GetGameTimer() / 1000) + serverTimeDelta
        })
    end
end)

RegisterNetEvent('carplay:client:partyResult', function(payload)
    SendNUIMessage({
        action = 'partyResult',
        ok = payload and payload.ok or false,
        message = payload and payload.message or ''
    })
end)

RegisterNetEvent('carplay:client:partyNearby', function(players)
    SendNUIMessage({
        action = 'partyNearby',
        players = players or {}
    })
end)

RegisterNetEvent('carplay:client:partyInvite', function(payload)
    partyInvitePending = true
    SendNUIMessage({
        action = 'partyInvite',
        hostName = payload and payload.hostName or 'Alguien'
    })
    TriggerEvent('chat:addMessage', {
        args = { 'Party', (payload and payload.hostName or 'Alguien') .. ' te invitó a su música. Y para aceptar, N para rechazar.' }
    })
end)

RegisterNetEvent('carplay:client:partyInviteClear', function()
    partyInvitePending = false
    SendNUIMessage({ action = 'partyInviteClear' })
end)

RegisterCommand('carplaypartyaccept', function()
    if not partyInvitePending then return end
    partyInvitePending = false
    TriggerServerEvent('carplay:server:partyRespond', true)
end, false)

RegisterCommand('carplaypartydecline', function()
    if not partyInvitePending then return end
    partyInvitePending = false
    TriggerServerEvent('carplay:server:partyRespond', false)
end, false)

RegisterCommand('salirparty', function()
    if not party.active then
        TriggerEvent('chat:addMessage', { args = { 'Party', 'No estás en una party.' } })
        return
    end
    TriggerServerEvent('carplay:server:partyLeave')
end, false)

RegisterKeyMapping('carplaypartyaccept', 'Aceptar invitación de Party Music', 'keyboard', 'Y')
RegisterKeyMapping('carplaypartydecline', 'Rechazar invitación de Party Music', 'keyboard', 'N')
