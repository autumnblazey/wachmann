import net from "net";
import { client_messages } from "./client-messages";
import { message_parser, user_parser } from "./server-messages";
import { inspect } from "util";
import type { Database } from "arangojs";
import type {
	GetConfig,
	UpdateConfig,
	SaveMessage,
	GetMessage,
	SaveUser,
	GetUser
} from "./client-messages";
import type { ServerMessages } from "./server-messages";
import { config_parser } from "./config";

export async function create_handle_data(
	connection: net.Socket,
	db: Database
) {
	const newline_buf = Buffer.from("\n");
	let residual_data = "";

	const messages_collection = db.collection<Record<string, unknown>>("messages");
	if (!await messages_collection.exists()) await messages_collection.create();

	const users_collection = db.collection<Record<string, unknown>>("users");
	if (!await users_collection.exists()) await users_collection.create();

	const config_collection = db.collection<Record<string, unknown>>("config");
	if (!await config_collection.exists()) await config_collection.create();

	return { write, handle_data };

	function write(data: ServerMessages): Promise<void> {
		return new Promise((res, rej) => {
			connection.write(
				Buffer.concat([Buffer.from(JSON.stringify(data)), newline_buf]),
				err => err ? rej(err) : res()
			);
		});
	}

	function handle_data(data?: Buffer) {
		if (data) residual_data += data.toString();

		while (true) {
			let next_newline_index = residual_data.indexOf("\n");
			if (next_newline_index === -1) return;

			let unparsed_data = residual_data.substring(0, next_newline_index);
			residual_data = residual_data.substring(next_newline_index + 1).trimStart();

			let parse_result = client_messages.safeParse(JSON.parse(unparsed_data));
			if (!parse_result.success) {
				write({
					message: "error",
					error: JSON.stringify(parse_result.error.format(), null, 3)
				});
				continue;
			}

			let data = parse_result.data;

			if (data.message === "get_config") {
				return handle_get_config(data);
			}
			if (data.message === "update_config") {
				return handle_update_config(data);
			}
			if (data.message === "save_message") {
				return handle_save_message(data);
			}
			if (data.message === "get_message") {
				return handle_get_message(data);
			}
			if (data.message === "save_user") {
				return handle_save_user(data);
			}
			if (data.message === "get_user") {
				return handle_get_user(data);
			}

			// i trust typescript and my ability to program, but also meh why not lol

			// send back a response so the bot can kinda continue
			write({
				message: "error",
				error: `Unknown message: ${(data as any).message}`
			});

			console.error("UNKNOWN MESSAGE HAPPENED");
			console.error(inspect(data, {
				showHidden: true,
				depth: 1000,
				getters: true
			}));
		}
	}

	async function handle_get_config (query: GetConfig) {
		let config = await config_collection.document(
			{ _key: query.id },
			{ graceful: true }
		);

		if (!config) return void write({ message: "no" });

		let config_parse_result = config_parser.safeParse({
			guild: config._id,
			...config
		});
		if (!config_parse_result.success) return void write({
			message: "error",
			error: JSON.stringify(config_parse_result.error.format())
		});

		write({
			message: "config",
			config: config_parse_result.data
		});
	}

	async function handle_update_config(query: UpdateConfig) {
		let _key = query.config.guild;
		// @ts-expect-error
		delete query.config.guild

		config_collection.save(
			{ _key, ...query.config },
			{ overwriteMode: "update" }
		);

		write({ message: "config", config: {
			...query.config,
			guild: _key
		}});
	}

	async function handle_save_message(query: SaveMessage) {
		// @ts-expect-error
		delete query.message; delete query.id;
		await messages_collection.save(query);
		write({ message: "ok" });
	}

	async function handle_get_message(query: GetMessage) {
		let msg = await messages_collection.document(
			{ _key: query.id },
			{ graceful: true }
		);

		if (!msg) return void write({ message: "no" });

		let msg_parse_result = message_parser.safeParse({
			message: "message",
			...msg,
			id: msg._key
		});
		if (!msg_parse_result.success) return void write({
			message: "error",
			error: JSON.stringify(msg_parse_result.error.format())
		});

		write(msg_parse_result.data);
	}

	async function handle_save_user(query: SaveUser) {
		// @ts-expect-error
		delete query.message; delete query.id;
		await users_collection.save(query);
		write({ message: "ok" });
	}

	async function handle_get_user(query: GetUser) {
		let user = await users_collection.document(
			{ _key: query.id },
			{ graceful: true }
		);

		if (!user) return void write({ message: "no" });

		let user_parse_result = user_parser.safeParse({
			message: "user",
			...user,
			id: user._key
		});
		if (!user_parse_result.success) return void write({
			message: "error",
			error: JSON.stringify(user_parse_result.error.format())
		});

		write(user_parse_result.data);
	}
}
