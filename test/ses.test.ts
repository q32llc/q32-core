import { describe, expect, it, vi } from "vitest";
import { createAwsConfigFromEnv } from "../src/aws.js";
import { buildListUnsubscribeHeaders, buildRawMimeMessage } from "../src/email.js";
import { createSesMailerFromEnv, inboundSesMxHost, sendSesEmail } from "../src/ses.js";
import {
  confirmSnsSubscription,
  extractSesFeedbackRecipients,
  isTrustedSnsSubscribeUrl,
  parseSesFeedbackNotification,
  parseSesReceiptNotification,
  parseSnsEnvelope,
} from "../src/ses-sns.js";

describe("AWS config helpers", () => {
  it("accepts both Q32 AWS env naming families", () => {
    expect(createAwsConfigFromEnv({
      AWS_ACCESS_KEY: "key",
      AWS_SECRET_KEY: "secret",
    })).toMatchObject({ accessKeyId: "key", secretAccessKey: "secret", region: "us-east-1" });
    expect(createAwsConfigFromEnv({
      AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "us-west-2",
    })).toMatchObject({ accessKeyId: "id", secretAccessKey: "secret", region: "us-west-2" });
  });
});

describe("email MIME helpers", () => {
  it("builds raw MIME with custom headers and attachments", () => {
    const mime = buildRawMimeMessage({
      from: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "to@example.com" }],
      subject: "Hello ü",
      text: "Text body",
      html: "<p>HTML body</p>",
      headers: {
        "List-Unsubscribe": "<https://example.com/u>\r\nBad: nope",
      },
      attachments: [{
        filename: "report.csv",
        contentType: "text/csv; charset=UTF-8",
        data: "a,b\n1,2\n",
      }],
      boundaryPrefix: "test",
    });

    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("Content-Type: multipart/alternative;");
    expect(mime).toContain("List-Unsubscribe: <https://example.com/u> Bad: nope");
    expect(mime).toContain("Content-Disposition: attachment; filename=\"report.csv\"");
    expect(mime).not.toContain("\r\nBad:");
  });

  it("builds one-click unsubscribe headers", () => {
    expect(buildListUnsubscribeHeaders("https://example.com/unsub")).toEqual({
      "List-Unsubscribe": "<https://example.com/unsub>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("SES helpers", () => {
  it("sends simple email through SES v2 HTTP API", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.Content.Simple.Subject.Data).toBe("Subject");
      expect(body.FromEmailAddress).toBe("from@example.com");
      return Response.json({ MessageId: "msg_123" });
    });

    await expect(sendSesEmail({
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
    }, {
      from: { email: "from@example.com" },
      to: [{ email: "to@example.com" }],
      subject: "Subject",
      text: "Body",
    }, { fetcher })).resolves.toEqual({ provider: "ses", messageId: "msg_123" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("creates configured and noop mailers from env", () => {
    expect(createSesMailerFromEnv({}).enabled).toBe(false);
    expect(createSesMailerFromEnv({
      AWS_ACCESS_KEY: "key",
      AWS_SECRET_KEY: "secret",
      EMAIL_FROM: "from@example.com",
    }).enabled).toBe(true);
    expect(inboundSesMxHost("us-west-2")).toBe("inbound-smtp.us-west-2.amazonaws.com");
  });
});

describe("SES SNS helpers", () => {
  it("validates and confirms trusted SNS subscription URLs", async () => {
    expect(isTrustedSnsSubscribeUrl("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription")).toBe(true);
    expect(isTrustedSnsSubscribeUrl("https://example.com/?Action=ConfirmSubscription")).toBe(false);
    const fetcher = vi.fn(async () => new Response("ok"));
    await expect(confirmSnsSubscription({
      Type: "SubscriptionConfirmation",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
    }, fetcher)).resolves.toBe(true);
  });

  it("extracts bounce and complaint recipients", () => {
    expect(extractSesFeedbackRecipients({
      eventType: "Bounce",
      bounce: { bouncedRecipients: [{ emailAddress: "A@Example.com" }] },
    })).toEqual({ eventType: "Bounce", emails: ["a@example.com"] });
    expect(extractSesFeedbackRecipients({
      notificationType: "Complaint",
      mail: { destination: ["fallback@example.com"] },
    })).toEqual({ eventType: "Complaint", emails: ["fallback@example.com"] });
  });

  it("parses feedback and receipt notifications", () => {
    const feedback = parseSnsEnvelope(JSON.stringify({
      Type: "Notification",
      MessageId: "sns-1",
      TopicArn: "arn",
      Message: JSON.stringify({
        eventType: "Bounce",
        bounce: { bouncedRecipients: [{ emailAddress: "bounce@example.com" }] },
      }),
    }));
    expect(feedback && parseSesFeedbackNotification(feedback)).toEqual({
      eventType: "Bounce",
      emails: ["bounce@example.com"],
      messageId: "sns-1",
      topicArn: "arn",
    });

    const receipt = parseSnsEnvelope(JSON.stringify({
      Type: "Notification",
      MessageId: "sns-2",
      Message: JSON.stringify({
        mail: { messageId: "mail-1", source: "from@example.com", commonHeaders: { subject: "Hi" } },
        receipt: { recipients: ["inbound@example.com"] },
      }),
    }));
    expect(receipt && parseSesReceiptNotification(receipt)).toEqual({
      messageId: "mail-1",
      source: "from@example.com",
      subject: "Hi",
      recipients: ["inbound@example.com"],
      snsMessageId: "sns-2",
    });
  });
});
