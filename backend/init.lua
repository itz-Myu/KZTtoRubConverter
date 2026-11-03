local PLUGIN_NAME = "kzt_rub_converter"
local WEBKIT_LOADER_PATH = ".millennium/Dist/webkit.js"
local WEBKIT_CONFIG_PATH = ".millennium/Dist/converter_config.js"

local millennium = nil
local logger = nil
local plugin_log_path = nil

local function normalize_path(path)
	local normalized = tostring(path or "")
	normalized = normalized:gsub("\\", "/")
	normalized = normalized:gsub("/+", "/")
	if normalized:match("^%a:/$") then
		return normalized
	end
	return normalized:gsub("/$", "")
end

local function path_join(...)
	local parts = { ... }
	local result = ""
	for i = 1, #parts do
		local part = tostring(parts[i] or "")
		if part ~= "" then
			part = normalize_path(part)
			if result == "" then
				result = part
			else
				result = result:gsub("/$", "")
				part = part:gsub("^/+", "")
				result = result .. "/" .. part
			end
		end
	end
	return normalize_path(result)
end

local function get_current_plugin_dir()
	local info = debug.getinfo(1, "S")
	local source = info and info.source or ""
	if source:sub(1, 1) == "@" then
		source = source:sub(2)
	end
	source = normalize_path(source)
	source = source:gsub("/[^/]+$", "")
	return source:gsub("/backend$", "")
end

local function append_file_log(level, message)
	if not plugin_log_path then
		return
	end
	local handle = io.open(plugin_log_path, "ab")
	if handle then
		handle:write("[" .. os.date("%Y-%m-%d %H:%M:%S") .. "] [" .. level .. "] " .. tostring(message) .. "\n")
		handle:close()
	end
end

local function log_to_millennium(level, message)
	if not logger then
		return
	end
	if level == "ERROR" and logger.error then
		pcall(function()
			logger:error(message)
		end)
	elseif level == "WARN" and logger.warn then
		pcall(function()
			logger:warn(message)
		end)
	elseif logger.info then
		pcall(function()
			logger:info(message)
		end)
	end
end

local function log_message(level, message)
	local formatted = "[" .. PLUGIN_NAME .. "] " .. tostring(message)
	append_file_log(level, formatted)
	log_to_millennium(level, formatted)
end

local function log_info(message)
	log_message("INFO", message)
end
local function log_warn(message)
	log_message("WARN", message)
end
local function log_error(message)
	log_message("ERROR", message)
end

local function fail(message)
	log_error(message)
	error(message, 2)
end

local function file_exists(path)
	local handle = io.open(normalize_path(path), "rb")
	if handle then
		handle:close()
		return true
	end
	return false
end

local function write_file(path, content)
	local normalized = normalize_path(path)
	local handle, open_err = io.open(normalized, "wb")
	if not handle then
		return nil, "failed to open: " .. normalized .. " (" .. tostring(open_err) .. ")"
	end
	local ok, write_err = handle:write(content)
	handle:close()
	if ok == nil then
		return nil, "failed to write: " .. tostring(write_err)
	end
	return true
end

local function escape_js_string(value)
	return tostring(value or ""):gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\r", "\\r"):gsub("\n", "\\n")
end

local function write_webkit_config(path)
	-- Заглушка. Она больше не используется для конвертации,
	-- так как converter.js напрямую дергает API Steam.
	local content = 'window.KZT_RUB_CONVERTER_CONFIG = { rubPerKzt: 1, source: "Steam Native API" };\n'
	return write_file(path, content)
end

local function load_runtime_modules()
	local ok, result
	ok, result = pcall(require, "logger")
	if ok then
		logger = result
		log_info("Millennium logger module loaded")
	else
		append_file_log("WARN", "failed to load Millennium logger module")
	end

	ok, result = pcall(require, "millennium")
	if ok then
		millennium = result
		log_info("Millennium API module loaded")
	else
		fail("failed to load Millennium API module")
	end
end

local function prepare_webkit_config()
	local plugin_dir = get_current_plugin_dir()
	local source_js = path_join(plugin_dir, "webkit", "converter.js")
	local source_css = path_join(plugin_dir, "webkit", "converter.css")
	local loader_path = path_join(plugin_dir, WEBKIT_LOADER_PATH)
	local config_path = path_join(plugin_dir, WEBKIT_CONFIG_PATH)

	log_info("plugin path: " .. plugin_dir)
	log_info("source JS: " .. source_js)
	log_info("WebKit loader: " .. loader_path)

	if not file_exists(source_js) then
		fail("source JS does not exist: " .. source_js)
	end
	if not file_exists(source_css) then
		fail("source CSS does not exist: " .. source_css)
	end
	if not file_exists(loader_path) then
		fail("WebKit loader does not exist: " .. loader_path)
	end

	local ok, err = write_webkit_config(config_path)
	if not ok then
		fail("failed to write WebKit config: " .. tostring(err))
	end
	log_info("WebKit config written successfully")
end

local function on_load_impl()
	plugin_log_path = path_join(get_current_plugin_dir(), "kzt_rub_converter.log")
	append_file_log("INFO", "[" .. PLUGIN_NAME .. "] file logger initialized")

	load_runtime_modules()
	prepare_webkit_config()

	log_info("calling millennium.ready()")
	millennium.ready()
end

local function on_load()
	local ok, err = xpcall(on_load_impl, debug.traceback)
	if not ok then
		log_error("on_load failed:\n" .. tostring(err))
		if millennium and millennium.ready then
			pcall(function()
				millennium.ready()
			end)
		end
	end
end

local function on_unload() end

return {
	on_load = on_load,
	on_unload = on_unload,
}
