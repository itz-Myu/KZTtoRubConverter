local PLUGIN_NAME = "kzt_rub_converter"

local function normalize_path(path)
	local normalized = tostring(path or "")
	-- Меняем обратные слеши на прямые для Linux
	normalized = normalized:gsub("\\", "/")
	normalized = normalized:gsub("/+", "/")
	return normalized
end

local function append_boot_log(path, message)
	local handle = io.open(path, "ab")
	if not handle then
		return
	end

	handle:write("[" .. os.date("%Y-%m-%d %H:%M:%S") .. "] " .. tostring(message) .. "\n")
	handle:close()
end

local source = debug.getinfo(1, "S").source or ""
if source:sub(1, 1) == "@" then
	source = source:sub(2)
end

local backend_dir = normalize_path(source):gsub("/[^/]+$", "")
local plugin_dir = backend_dir:gsub("/backend$", "")
local boot_log_path = plugin_dir .. "/" .. PLUGIN_NAME .. "_boot.log"
local init_path = backend_dir .. "/init.lua"

append_boot_log(boot_log_path, "main.lua started")
append_boot_log(boot_log_path, "loading init.lua from: " .. init_path)

local ok, result = pcall(dofile, init_path)
if not ok then
	append_boot_log(boot_log_path, "failed to load init.lua: " .. tostring(result))
	error(result, 0)
end

append_boot_log(boot_log_path, "init.lua loaded successfully")
return result
