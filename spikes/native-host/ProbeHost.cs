using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class ProbeHost {
  static bool ReadAll(Stream input, byte[] buffer) {
    int offset=0; while(offset<buffer.Length){int n=input.Read(buffer,offset,buffer.Length-offset);if(n==0)return false;offset+=n;}return true;
  }
  static void Main() {
    var input=Console.OpenStandardInput();var output=Console.OpenStandardOutput();var json=new JavaScriptSerializer();
    while(true){
      var header=new byte[4];if(!ReadAll(input,header))return;
      int size=BitConverter.ToInt32(header,0);if(size<1||size>32768)return;
      var data=new byte[size];if(!ReadAll(input,data))return;
      var request=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(data));
      if(!request.ContainsKey("kind")||Convert.ToString(request["kind"])!="ping")return;
      var response=new Dictionary<string,object>{{"kind","pong"},{"nonce",request.ContainsKey("nonce")?request["nonce"]:null},{"host","polarion-sidebar-s1"},{"protocol",1}};
      var bytes=Encoding.UTF8.GetBytes(json.Serialize(response));output.Write(BitConverter.GetBytes(bytes.Length),0,4);output.Write(bytes,0,bytes.Length);output.Flush();
    }
  }
}
